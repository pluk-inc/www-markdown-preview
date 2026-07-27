/**
 * Regenerates src/data/companies.json from the GitHub stargazers of the repo.
 *
 * Every name on the site's "Trusted by" strip and /companies page comes from
 * here: the `company` field a stargazer put on their own GitHub profile. It is
 * self-reported and unverified — that caveat is printed on the page.
 *
 * Usage:  GH_TOKEN=$(gh auth token) node scripts/fetch-companies.mjs
 */
import { writeFileSync } from "node:fs";

const OWNER = "pluk-inc";
const REPO = "markdown-preview";
const OUT = new URL("../src/data/companies.json", import.meta.url);

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Set GH_TOKEN (try: GH_TOKEN=$(gh auth token) node scripts/fetch-companies.mjs)");
  process.exit(1);
}

const QUERY = `
  query ($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      stargazerCount
      stargazers(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          company
          # Public org memberships — a second source, and the only source for
          # the many people who leave the company field blank. isVerified means
          # the org proved it owns its domain, which is what separates a real
          # employer from a hobby project.
          organizations(first: 10) {
            nodes {
              login
              name
              isVerified
              websiteUrl
              membersWithRole { totalCount }
            }
          }
        }
      }
    }
  }
`;

/**
 * Names that don't come from GitHub at all — someone told us directly. They are
 * merged in after the verification pass and skip it entirely, because there is
 * nothing on GitHub to check them against.
 *
 * Only add a name here when a person who works there said so. Record who and
 * when, so the claim can be traced later or withdrawn if asked. `verified` stays
 * false for these: it means "resolves to a real GitHub org", which is a
 * different question from whether someone there uses the app.
 */
const MANUAL = [
  // Confirmed privately to Fauzaan by an Apple employee, 2026-07-27. Not
  // visible in stargazer data — do not delete expecting a regeneration to
  // bring it back.
  { name: "Apple", education: false },
];

/** Profile values that name a status, not an employer. */
const NOT_A_COMPANY =
  /^(none|n\/a|null|null null|undefined|-|student|students?|self|#self|self-?employed|personal|me|freelance|freelancer|freelancing|independent|indie|unemployed|jobless|home|earth|world|internet|web3|crypto|stealth|stealth startup|remote|various|multiple|open to (work|new opportunities|opportunities)|looking for (a )?job|developer|developer \/ engineer|engineer|programmer|10x company|백수|ceo|cto|cio|ciso|coo|founder|co-?founder|freelance ios and web developer|it consulting & partner)$/i;

/** Universities, colleges and public research institutes get their own list. */
const EDUCATION =
  /univers|universidade|università|universidad|college|institute of technology|\bschool\b|\bhochschule\b|\bcnrs\b|\binria\b|fraunhofer|academy|\bkaist\b|\bepfl\b|\bkth\b|\biit\b|\bmit\b|\bbupt\b|\bsjtu\b|\bpku\b|polytechnic|rijksuniversiteit|politecnico|\.edu(\.[a-z]{2})?$|^(sdu|polyu|hqu|ufg|nit\b|epitech|sup galilée|n-highscool|ashesi)/i;

/** Casing the brands own, which a naive title-case would mangle. */
const CANONICAL = new Map(
  [
    "ByteDance", "TikTok", "GitHub", "GitLab", "OpenAI", "NVIDIA", "JPMorgan Chase",
    "SAP", "IBM", "PayPal", "eBay", "iFood", "OPPO", "vivo", "Xiaomi",
    "Huawei", "Baidu", "Alibaba", "Tencent", "NHN", "KT", "LG", "CJ OliveYoung",
    "Booking.com", "Z.ai", "VML", "BT", "TCS", "EPAM", "NTT", "KPMG", "PwC",
    "Société Générale", "Crédit Mutuel Arkéa", "PrestaShop", "TigerData",
    "Test Double", "Cash App", "DigitalOcean", "MongoDB", "HashiCorp", "Red Hat",
    "Hugging Face", "Mercado Libre", "Viva Republica (Toss)",
    "Hyundai AutoEver", "Software Mansion", "CyberAgent", "Cookpad", "Prusa Research",
    "Karrot", "Sea (Shopee)", "The Atlantic", "Mindvalley", "Automattic", "Twilio",
    "Paramount", "Broadcom", "Lenovo", "Meituan", "China Telecom", "CITIC Bank",
    "Arm", "Oracle", "Samsung", "Spotify", "Reddit", "Docker", "Notion", "Cursor",
    "Vercel", "Shopify", "Meta", "Yandex", "Instacart", "Mapbox", "Flipkart",
    "Wipro", "Infosys", "Deloitte", "Accenture", "Sanofi", "Bosch", "Siemens",
  ].map((n) => [n.toLowerCase().replace(/[^a-z0-9]/g, ""), n]),
);

/** A few profile spellings that should collapse onto one canonical name. */
const ALIASES = new Map(
  Object.entries({
    "vivarepublicainctoss": "Viva Republica (Toss)",
    "shopeesealtd": "Sea (Shopee)",
    "paramountstreaming": "Paramount",
    // Wholly-owned subsidiary; shown under the parent brand on the logo strip.
    "rakutenmobileinc": "Rakuten",
    "rakutenmobile": "Rakuten",
    "daangn": "Karrot",
    "tencentcloud": "Tencent",
    "amazon": "Amazon",
    "aws": "Amazon",
    // Not spelling variants — these are whole profile strings `split()` can't
    // break up, because it deliberately won't split on a bare comma ("Shanghai
    // Jiao Tong University, SJTU" has to survive). Each keeps the first employer.
    "chinatelecommeituanbosch": "Meituan",
    "cashappblocksquare": "Block",
    "vercelrecursivelabs": "Vercel",
    "facebook": "Meta",
    "easports": "EA Sports",
    "societegenerale": "Société Générale",
    "creditmutuelarkea": "Crédit Mutuel Arkéa",
  }),
);

/**
 * People pack several employers into one field: "@alibaba -> @tencent",
 * "@cashapp @block @square", "ClearScore / @AniTrend". Split those apart so each
 * employer is counted once, then throw away the fragments that aren't employers
 * (email addresses, bare punctuation, job titles).
 */
const split = (raw) =>
  raw
    .split(/\s*(?:->|→|;|\||\/|,\s*(?=@))\s*|\s+(?=@)/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const clean = (raw) =>
  raw
    .replace(/^@/, "")
    .replace(/^(ex|former(ly)?|prev(iously)?|at|@)\s+/i, "")
    // "Principal Engineer at Amazon" — keep the employer, drop the title.
    .replace(/^(principal|senior|sr\.?|staff|lead|chief|head|director|vp)\b.*?\bat\s+/i, "")
    // Split debris: dangling conjunctions and "oss &" style suffixes.
    .replace(/\s+(and|&|oss\s*&)$/i, "")
    .replace(/[.,;:/\\|·\-–—]+$/, "")
    .replace(/[,\s]+(inc|llc|ltd|gmbh|corp|co|a\.s|as|oü|srl|s\.a)\.?$/i, "")
    .trim();

/**
 * Judged case-by-case from the real data: jokes, moods and slogans people put
 * in the company field. Matched after cleaning, case-insensitively.
 */
const DENY = new Set(
  [
    "i don`t wanna go to work",
    "i don't wanna go to work",
    "drinking coffee or beer beer somewhere out there",
    "tbn - clever name here",
    "overspace & hack the world",
    "mindmyownbusiness",
    "unlimited distractions",
    "selfcontrol",
    "hacker yisus",
    "graduate of ironhack, berlin",
    "engineer, entrepreneur, investor",
    "attorneys c", // split artifact of "attorneys c|h|z"
    "network",
    "poydevor maintainer",
    "floss-uz contributer",
  ].map((s) => s.toLowerCase()),
);

/** Words that mark a long string as an organization, not a sentence. */
const ORG_HINT =
  /univers|college|institute|school|academy|\bbank\b|\bgroup\b|\blabs?\b|technolog|solutions|consulting|systems|software|digital|media|capital|foundation|ventures|telecom|holdings|partners|studios?|clinic|hospital|\bcorp\b|\bs\.a\b/i;

/**
 * Reads as a sentence or a mood rather than an employer name: exclamation and
 * question marks, first-person openers, or a long run of words with nothing in
 * it that looks like an organization ("Shanghai Jiao Tong University, SJTU" is
 * five words and must survive).
 */
const isProse = (name) =>
  /[!?]/.test(name) ||
  /^i[\s'`’]/i.test(name) ||
  (name.split(/\s+/).length > 4 && !ORG_HINT.test(name));

/** Fragments that survive splitting but don't name an employer. */
const isJunk = (name) =>
  DENY.has(name.toLowerCase().replace(/[!.]+$/, "")) ||
  isProse(name) ||
  // Needs at least three letters/digits, so ":De" and split debris like "H" go.
  (name.match(/[a-z0-9]/gi)?.length ?? 0) < 3 ||
  /@/.test(name) || // leftover email address
  /^#/.test(name) ||
  /^(https?:)?\/\//.test(name) ||
  NOT_A_COMPANY.test(name);

const key = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const display = (name) =>
  CANONICAL.get(key(name)) ??
  // Leave anything with existing capitals alone; only fix all-lowercase handles.
  (name === name.toLowerCase()
    ? name.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
    : name);

/** POST a GraphQL query and return `data`, failing loudly on any error. */
const gql = async (query, variables) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
};

let after = null;
let stars = 0;
const raw = [];

do {
  const repo = (await gql(QUERY, { owner: OWNER, repo: REPO, after })).repository;
  stars = repo.stargazerCount;
  for (const node of repo.stargazers.nodes) {
    raw.push({
      company: node.company?.trim() ?? "",
      orgs: node.organizations?.nodes ?? [],
    });
  }
  after = repo.stargazers.pageInfo.hasNextPage ? repo.stargazers.pageInfo.endCursor : null;
  process.stderr.write(`\r${raw.length} employers collected…`);
} while (after);
process.stderr.write("\n");

const companies = new Map();
const schools = new Map();
/** Org memberships with no matching company text, pending corroboration. */
const orgOnly = new Map();

/**
 * Orgs anyone can join, so membership says nothing about employment. Epic's org
 * adds every account that links an Unreal Engine licence.
 */
const OPEN_MEMBERSHIP = new Set([
  "epicgames",
  "unrealengine",
  "github",
  "githubpartners",
  "github-partners",
  "microsoftdocs",
]);

/** Community patterns: user groups, clubs, courses, game servers. */
const COMMUNITY =
  /club|community|communities|users?group|meetup|bootcamp|students?|awesome|learn|tutorial|course|workshop|hack(athon|club)|minecraft|\bmc\b|gamers?|dev(elopers)?[-_]?(group|community)|gdg|opensource|oss$/i;

/** Does a GitHub org look like somebody's employer? */
const looksLikeEmployer = (org) => {
  if (!org?.login || OPEN_MEMBERSHIP.has(org.login.toLowerCase())) return false;
  if (COMMUNITY.test(org.login) || COMMUNITY.test(org.name ?? "")) return false;
  const members = org.membersWithRole?.totalCount ?? 0;
  // Domain-verified orgs are the strong case; otherwise want a real team and a
  // website before treating a shared org as a workplace.
  return org.isVerified === true || (members >= 5 && Boolean(org.websiteUrl));
};

for (const { company, orgs } of raw) {
  // One profile can name several employers; count each at most once per person.
  const seen = new Set();

  /**
   * Names of orgs this person actually belongs to, for cross-checking. Only
   * needed when they filled in the company field, which most people don't.
   */
  const memberKeys = company
    ? new Set(orgs.flatMap((o) => [key(o.login ?? ""), key(o.name ?? "")]).filter(Boolean))
    : null;

  for (const part of split(company)) {
    const cleaned = clean(part);
    if (!cleaned || isJunk(cleaned)) continue;

    const name = ALIASES.get(key(cleaned)) ?? display(cleaned);
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);

    const bucket = EDUCATION.test(cleaned) ? schools : companies;
    const prev = bucket.get(k);
    bucket.set(k, {
      name,
      count: (prev?.count ?? 0) + 1,
      // Second source: they're a public member of an org by this name.
      memberConfirmed: prev?.memberConfirmed || memberKeys.has(k),
      // A leading "@" followed by a valid login means the person pointed at a
      // specific GitHub account, which can be checked. "@Nanjing University of
      // …" is prose that happens to start with @, so it doesn't count.
      handle: prev?.handle || /^@[A-Za-z0-9][A-Za-z0-9-]*$/.test(part.trim()),
      login: prev?.login ?? part.trim().replace(/^@/, "").toLowerCase(),
    });
  }

  // Most stargazers leave the company field empty. For them a public org
  // membership is the only employer signal there is — but an org can equally be
  // an OSS project or a meetup, and no API field distinguishes those. So these
  // are held back and admitted below only with corroboration.
  for (const org of orgs) {
    if (!looksLikeEmployer(org)) continue;

    const label = clean(org.name?.trim() || org.login);
    if (!label || isJunk(label)) continue;

    const name = ALIASES.get(key(label)) ?? display(label);
    if (seen.has(key(name))) continue;
    seen.add(key(name));

    const prev = orgOnly.get(key(name));
    orgOnly.set(key(name), {
      name,
      people: (prev?.people ?? 0) + 1,
      label,
      login: prev?.login ?? org.login.toLowerCase(),
    });
  }
}

/**
 * A one-person org is as likely to be their side project as their employer.
 * Two or more colleagues in the same org is the corroboration that separates a
 * workplace from "someone contributes to AstroNvim".
 */
for (const entry of orgOnly.values()) {
  if (entry.people < 2) continue;

  const bucket = EDUCATION.test(entry.label) ? schools : companies;
  const prev = bucket.get(key(entry.name));
  bucket.set(key(entry.name), {
    name: entry.name,
    // Anyone counted from their company text was skipped above, so these add.
    count: (prev?.count ?? 0) + entry.people,
    memberConfirmed: true,
    handle: false,
    login: prev?.login ?? entry.login,
  });
}

/**
 * Verification pass. Every candidate is looked up on GitHub — by the handle the
 * person wrote, or by a slug of their free text as a best-effort guess.
 *
 *   Organization → real, keep and mark verified.
 *   User / 404   → only disqualifying for an explicit @handle, where the person
 *                  named that exact account. A slug guessed from free text can
 *                  collide with an unrelated username ("EA Sports" → @easports,
 *                  a private individual) or match nothing at all, and neither
 *                  tells us the employer isn't real — so free text is kept,
 *                  just marked unverified.
 */
const lookup = async (logins) => {
  const found = new Map();

  // Unlike the cursor-driven pagination above, these batches are independent,
  // so they run concurrently — ~13 round trips become one wait.
  const batches = [];
  for (let i = 0; i < logins.length; i += 40) batches.push(logins.slice(i, i + 40));

  await Promise.all(
    batches.map(async (batch) => {
      const fields = batch
        .map(
          (login, n) =>
            `k${n}: repositoryOwner(login: ${JSON.stringify(login)}) { __typename login }`,
        )
        .join("\n");
      const data = await gql(`query { ${fields} }`);
      batch.forEach((login, n) => found.set(login, data[`k${n}`]?.__typename ?? null));
      process.stderr.write(`\r${found.size}/${logins.length} names checked…`);
    }),
  );

  return found;
};

const candidates = [...companies.values(), ...schools.values()];
const slug = (entry) => (entry.handle ? entry.login : key(entry.name));
const types = await lookup([...new Set(candidates.map(slug))]);
process.stderr.write("\n");

const dropped = { personalAccount: [], deadHandle: [] };

for (const bucket of [companies, schools]) {
  for (const [k, entry] of bucket) {
    const type = types.get(slug(entry));
    if (type === "Organization" || entry.memberConfirmed) {
      bucket.set(k, { ...entry, verified: true });
      continue;
    }
    if (entry.handle) {
      // They named this account explicitly, so the answer is authoritative.
      (type === "User" ? dropped.personalAccount : dropped.deadHandle).push(entry.name);
      bucket.delete(k);
      continue;
    }
    bucket.set(k, { ...entry, verified: false });
  }
}

console.error(
  `dropped ${dropped.personalAccount.length} personal accounts: ${dropped.personalAccount.join(", ")}`,
);
console.error(
  `dropped ${dropped.deadHandle.length} handles that don't exist: ${dropped.deadHandle.join(", ")}`,
);

// Merged last so the verification pass above can't drop them — there is nothing
// on GitHub backing these, which is the whole point of the list.
for (const entry of MANUAL) {
  const bucket = entry.education ? schools : companies;
  const k = key(entry.name);
  if (bucket.has(k)) continue; // already found in the data; nothing to add
  bucket.set(k, { name: entry.name, count: 1, verified: false, manual: true });
}
console.error(`added ${MANUAL.length} manually confirmed: ${MANUAL.map((m) => m.name).join(", ")}`);

const sort = (map) =>
  [...map.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en"))
    // `handle`/`login` are working state; the site only needs these.
    .map(({ name, count, verified, manual }) => ({
      name,
      count,
      verified,
      ...(manual ? { manual: true } : {}),
    }));

const data = {
  // Sourced from GitHub profiles, so this is a snapshot, not a live figure.
  generatedAt: new Date().toISOString().slice(0, 10),
  stars,
  stargazersWithEmployer: raw.filter((r) => r.company).length,
  companies: sort(companies),
  schools: sort(schools),
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  `${data.companies.length} companies + ${data.schools.length} schools from ${stars} stargazers → src/data/companies.json`,
);
