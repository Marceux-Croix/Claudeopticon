import { expect, test } from 'claude-code/testing'

import { readClaims, readProgress } from '../hooks/progress-report'
import { hasSecret, HIDDEN, hideNormalizedSecretLines, hideSecretLines, hideSecrets, hideTitle, SECRET_PATTERNS } from '../hooks/secrets'
import { callDetail, callSummary, describeCall } from '../hooks/tool-calls'
import { EXTRA_RUNS, inputsOf, LARGE, RATIO_MAX, SMALL, stepRatio, superlinear, unitsOf } from './fixtures/pattern-growth'
import { stepCounter } from './fixtures/regex-steps'
import { J6_PLAIN, J6_SECRET, KEY_BODY, KEY_SECRET, L2_PLAIN, L2_SECRET, L3_PLAIN, L3_SECRET, M_PLAIN, M_SECRET, MORE_PLAIN, MORE_SECRET, PLAIN, SECRET } from './fixtures/secret-corpus'

test('UCR-029 hideSecrets keeps the orchestrator detail rule', () => {
  expect(hideSecrets('ls -la')).toBe('ls -la')
  // UCR-001 (H5): the word "secret" alone is no longer hidden, so `my secret` became `my secret=x`.
  for (const text of ['x --password y', 'a token=b', 'Authorization: z', 'API_KEY=1', 'my secret=x']) {
    expect(hideSecrets(text)).toBe('(hidden)')
  }
})

// ---------------------------------------------------------------- UCR-001

const SECRET_COMMANDS = [
  'PGPASSWORD=hunter2 psql -h db app',
  'mysql -u root -phunter2 app',
  'mysql -h db -u root -p"hunter2"',
  'curl -u admin:hunter2 https://example.com/a',
  'curl --user admin:hunter2 https://example.com/a',
  'git clone https://user:hunter2@github.com/a/b.git',
  'git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b.git',
  'gh auth login --with-token < tok',
  'curl -H "Cookie: sid=hunter2" https://example.com',
  'curl -H "cookie: sid=hunter2" https://example.com',
  'curl -H "Authorization: Bearer hunter2" https://example.com',
  'curl "https://example.com/a?access_token=hunter2"',
  'curl "https://example.com/a?x=1&api_key=hunter2"',
  'export GITHUB_TOKEN=gho_abcdefghijklmnop',
  'echo github_pat_11ABCDEFG0abcdefghijklmnop',
  'ANTHROPIC=sk-ant-api03-abcdefghijklmnop run',
  'curl -d token=xoxb-1234-5678-abcdefgh https://slack.com/api',
  'sshpass -p hunter2 ssh host',
  'sshpass -phunter2 ssh host',
  'curl --password hunter2 u',
  'export TOKEN=abc',
  'run --api_key k',
]

// UCR-001 (H5): `echo $SECRET` moved here from SECRET_COMMANDS: it names a variable and holds no secret.
const PLAIN_COMMANDS = ['echo $SECRET', 'npm test', 'ls -p', 'git log -p', 'mkdir -p /tmp/x', 'cp -pr a b', 'curl https://example.com/a?page=2', 'grep -rn "task-list" src', 'docker run image', 'git clone https://github.com/a/b.git', 'echo disk-usage']

test('UCR-001 hideSecrets hides every secret form and keeps plain text', () => {
  for (const text of SECRET_COMMANDS) {
    expect(hideSecrets(text)).toBe('(hidden)')
  }
  for (const text of PLAIN_COMMANDS) {
    expect(hideSecrets(text)).toBe(text)
  }
})

// ---------------------------------------------------------------- UCR-001, loop 1 narrowing

/** The forms verifier F found still shown in clear, and a few of their kin; see the rule in secrets.ts. */
const NARROWED_SECRETS = [
  // Short options of their own tools.
  'docker login -u bob -p hunter2',
  'podman login -u bob -p hunter2 quay.io',
  'mongosh -u a -p hunter2',
  'mongo -u admin -p hunter2',
  'redis-cli -a hunter2',
  'zip -P hunter2 out.zip a',
  'unzip -P hunter2 out.zip',
  '7z a -phunter2 out.7z a',
  'openssl enc -aes-256-cbc -k hunter2 -in a',
  'openssl rsa -passin pass:hunter2 -in key.pem',
  'ssh-keygen -t ed25519 -N hunter2 -f k',
  'htpasswd -b .htpasswd bob hunter2',
  'htpasswd -cb .htpasswd bob hunter2',
  'echo hunter2 | sudo -S apt update',
  'vault login s.Xabcdefghijkl',
  '/usr/bin/mysql -u root -phunter2',
  // Assignments.
  'MYSQL_PWD=hunter2 mysql',
  'export PW=hunter2',
  'export DB_PWD=hunter2',
  'DB_ROOT_PASS=hunter2 ./run',
  'export SSH_KEY=abc',
  'dbPassword=hunter2 node a.js',
  'curl -d \'{"password":"hunter2"}\' https://x.test',
  'curl -d \'{"token": "hunter2"}\' https://x.test',
  'curl -d \'{"pw": "hunter2"}\' https://x.test',
  // Headers and users.
  'curl -u sk_live_x: https://api.payments.example',
  'curl -H "X-Auth: hunter2" https://x.test',
  'curl -H "X-Api-Key: hunter2" https://x.test',
  'curl -H "PRIVATE-TOKEN: hunter2" https://gitlab.test',
  // URLs.
  'git clone https://hunter2tokenvalue@github.com/a/b',
  'curl https://hooks.slack.com/services/T000/B000/XXXX',
  'curl https://discord.com/api/webhooks/1/abc',
  'curl "https://x.test/cb#access_token=hunter2"',
  // Token shapes.
  'echo npm_abcdefghijklmnopqrstuvwxyz0123456789 > .npmrc',
  'curl -H "x: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig" https://x.test',
  'export V=hvs.abcdefghijklmnop',
  'run --api_key k',
]

/** Ordinary commands that must stay shown: each is near one of the forms above. */
const NEAR_PLAIN = [
  'docker run -p 8080:80 image',
  'docker run -u 1000:1000 image',
  'docker login ghcr.io',
  'mysql -u root -p app',
  'psql -h db -p 5432 app',
  'zip -r out.zip src',
  'unzip -p out.zip a.txt',
  'sudo apt update',
  'ssh-keygen -t ed25519 -f k',
  'git log --author=bob -p',
  'curl -X POST --data-binary @a.json https://x.test',
  'curl -d \'{"max_tokens": 1024}\' https://x.test',
  'export PATH=/usr/bin',
  'export KEYBOARD=us',
  'sort --key=2 a.txt',
  'npm run build --bypass-cache',
  'git clone git@github.com:a/b.git',
  'ssh git@github.com',
  'curl "https://x.test/?a=1&b=2#top"',
  'curl -H "X-Request-Id: 1" https://x.test',
  'pip install --user requests',
  'echo $HOME',
  'git push -u origin main',
  'npm_config_registry=https://r.test npm i',
  'tar -czpf a.tgz src',
  'openssl req -new -key k.pem -out c.csr',
  'ssh -p 2222 host',
  'git commit -m "fix the token parser"',
]

test('UCR-001 hideSecrets hides the narrowed forms and keeps the plain commands next to them', () => {
  for (const text of NARROWED_SECRETS) {
    expect([text, hideSecrets(text)]).toEqual([text, '(hidden)'])
  }
  for (const text of [...NEAR_PLAIN, ...PLAIN_COMMANDS]) {
    expect([text, hideSecrets(text)]).toEqual([text, text])
  }
})

test('UCR-001 a narrowed form is hidden behind a valid first part, at the far end of its reach, and in a quoted JSON key', () => {
  // State 1: a valid first command; the secret is in the second one.
  expect(hideSecrets('npm test && docker login -u bob -p hunter2')).toBe('(hidden)')
  // State 2: near the far end of the 200 characters a short option may sit from its tool.
  expect(hideSecrets(`docker login ${'-u bob '.repeat(27)}-p hunter2`)).toBe('(hidden)')
  // State 3: the population a plain NAME= rule leaves out, a quoted JSON key after another key.
  expect(hideSecrets('curl -d \'{"user":"a","password":"hunter2"}\' u')).toBe('(hidden)')
  // A short option of another tool, after a pipe, stays shown.
  expect(hideSecrets('docker login ghcr.io | grep -p x')).toBe('docker login ghcr.io | grep -p x')
})

test('UCR-029 hideSecretLines hides only the lines with a secret, and keeps their #IDs', () => {
  const text = ['Work on #T0037', 'Run: PGPASSWORD=hunter2 psql #T0040', 'Then close it'].join('\n')
  expect(hideSecretLines(text)).toBe(['Work on #T0037', '(hidden) #T0040', 'Then close it'].join('\n'))
  expect(hideSecretLines('plain text')).toBe('plain text')
})

// ---------------------------------------------------------------- UCR-001, the corpus (batch H5)

test('UCR-001 every command of the secret corpus is hidden, in the detail and the title lines', () => {
  const secrets = [...SECRET, ...MORE_SECRET, ...L2_SECRET, ...J6_SECRET, ...L3_SECRET, ...M_SECRET, ...KEY_SECRET]
  expect(secrets.length).toBeGreaterThanOrEqual(413)
  expect(secrets.filter(command => !hasSecret(command))).toEqual([])
  // Each view of a Bash call: its detail, its summary and its few words.
  const shown = secrets.filter(command => callDetail('Bash', { command }, 'x') !== HIDDEN || callSummary('Bash', { command }) !== `Bash: ${HIDDEN}` || describeCall('Bash', { command }) !== `Bash: ${HIDDEN}`)
  expect(shown).toEqual([])
})

test('UCR-001 every ordinary command of the corpus is shown as it is', () => {
  const plain = [...PLAIN, ...MORE_PLAIN, ...L2_PLAIN, ...J6_PLAIN, ...L3_PLAIN, ...M_PLAIN]
  expect(plain.length).toBeGreaterThanOrEqual(425)
  expect(plain.filter(command => hasSecret(command))).toEqual([])
  expect(plain.filter(command => hideSecrets(command) !== command)).toEqual([])
})

/**
 * Property (UCR-001, batch M): the verifier's final-v1 misses are hidden on every surface (expdp user/pw@db, yarn
 * npmAuthToken, security unlock-keychain -p, Sybase isql -P), and their ordinary neighbors stay shown.
 */
test('UCR-001 c001 expdp user/pw@db, yarn npmAuthToken, security unlock-keychain -p and isql -P are hidden; their neighbors shown', () => {
  const pw = 'Kestrel42Moth'
  // The defect behind a valid first command: each miss after a command that is shown.
  for (const command of [`echo start && expdp system/${pw}@orcl schemas=app`, `yarn install && yarn config set npmAuthToken ${pw}`, `ls && security unlock-keychain -p ${pw} login.keychain`, `cd db && isql -U sa -P ${pw} -S SYBASE`]) {
    expect([command, hasSecret(command), callDetail('Bash', { command }, 'x'), hideSecretLines(command).includes(pw)]).toEqual([command, true, HIDDEN, false])
  }
  // At the limit: the password as the last token, attached (-PX), and in the userid= form.
  expect(hasSecret(`security unlock-keychain -p ${pw}`)).toBe(true)
  expect(hasSecret(`isql -Usa -P${pw}`)).toBe(true)
  expect(hasSecret(`impdp userid=sys/${pw}`)).toBe(true)
  // The excluded population: the same tools with no secret in the command.
  expect(M_PLAIN.filter(command => hasSecret(command))).toEqual([])
  expect(M_SECRET.filter(command => !hasSecret(command))).toEqual([])
})

test('UCR-001 sudo -S is hidden only as sudo\'s own option: behind a valid first command, at the end of its option run, and inside the commands the fix shows', () => {
  // State 1: a valid first command that the fix shows, then the secret form.
  expect(hasSecret('sudo pacman -S git && echo pw | sudo -S id')).toBe(true)
  // State 2: the eighth option before -S, the end of the run the pattern reads.
  expect(hasSecret(`echo pw | sudo ${'-E '.repeat(7)}-u root -S id`)).toBe(true)
  // State 3: inside the population the fix shows (an -S of the command sudo runs), sudo's own -S still counts.
  expect(hasSecret('echo pw | sudo -S ls -laS')).toBe(true)
  expect(hasSecret('sudo ls -laS')).toBe(false)
})

test('UCR-001 the word secret, bearer, a key name and a flag value are shown, but a value next to them is hidden', () => {
  // State 1: behind a valid first part that names the word only.
  expect(hasSecret('kubectl get secrets && export CLIENT_SECRET=abc123')).toBe(true)
  expect(hasSecret('git commit -m "fix bearer parsing"; curl -H "Authorization: Bearer abc" u')).toBe(true)
  // State 2: at the limit of a name: a value right after the separator, and a quote then a value.
  expect(hasSecret('grep "password:x" a')).toBe(true)
  expect(hasSecret('grep "password:" a')).toBe(false)
  expect(hasSecret('echo \'{"password":"x"}\'')).toBe(true)
  // State 3: inside the names the fix shows (a setting, a data key), a secret value still counts.
  // `AUTH_ENABLED` is a setting (SETTING_PARTS has `enabled`); the flag-value rule is in the UCR-183 test.
  expect(hasSecret('export AUTH_ENABLED=true')).toBe(false)
  expect(hasSecret('export AUTH_ENABLED=true DB_AUTH=hunter2')).toBe(true)
  expect(hasSecret('export SORT_KEY=name')).toBe(false)
  expect(hasSecret('export SORT_KEY=name SIGNING_KEY=abc')).toBe(true)
  expect(hasSecret('docker run --user node:node app')).toBe(false)
  expect(hasSecret('docker run --user node:node app && curl --user bob:pw u')).toBe(true)
})

// ---------------------------------------------------------------- UCR-087, step ratios (loop 3; time ratios in batch H5)

// Loop 3 replaced the time ratios of these tests with step counts (tests/fixtures/pattern-growth.ts):
// the same checks and the same states, at sizes a step counter runs in seconds (1.5k and 3k, twice
// the text, where the time test used 10 times), so no load can fail or pass them.
test('UCR-087 no secret pattern grows faster than its text: steps(3k) / steps(1.5k) stays under RATIO_MAX on inputs built from each pattern\'s words', { timeoutMs: 120_000 }, () => {
  expect(SMALL).toBe(1_500)
  expect(LARGE).toBe(3_000)
  // Each pattern gets inputs from its own start words and tool names, not only the shared shapes.
  expect(unitsOf(SECRET_PATTERNS.find(re => re.source.includes('sudo'))!)).toContain('sudo ')
  // Two-token inputs: a URL start once, then a long run (loop 2, verifier HI's M-HI-1).
  expect(inputsOf(SECRET_PATTERNS[0]!)).toContainEqual({ head: 'a://', unit: 'x:' })
  // A word pair of the pattern as a head, then a run of spaces (loop 3, R6's M-V-2).
  expect(inputsOf(SECRET_PATTERNS.find(re => re.source.includes('authorization'))!)).toContainEqual({ head: 'authorization: bearer', unit: ' ' })
  expect(superlinear(SECRET_PATTERNS)).toEqual([])
})

/** One pattern of SECRET_PATTERNS with `from` changed to `to`: a mutant that makes it quadratic. */
function mutant(find: string, from: string, to: string): RegExp {
  const re = SECRET_PATTERNS.find(one => one.source.includes(find))!
  expect(re.source.includes(from)).toBe(true)

  return new RegExp(re.source.split(from).join(to), re.flags)
}

/** R6's M-V-2 (loop 3): the bearer value after `\s+["']?\s*`, 29.8 s on a 50k input, which the time ratio passed. */
const bearerMutant = (): RegExp => mutant('authorization', `(?:bearer|basic|token|digest|bot|negotiate|ntlm)\\s{1,5}["']?[^\\s"']|`, `(?:bearer|basic|token|digest|bot|negotiate|ntlm)\\s+["']?\\s*[^\\s"']|`)

test('UCR-087 the step check catches each quadratic mutant the fixed budget and the time ratio let pass', { timeoutMs: 120_000 }, () => {
  const mutants: [string, RegExp][] = [
    ['an assignment name made unbounded', mutant('sharedaccess', '[a-z0-9_]{0,40}', '[a-z0-9_]*')],
    // sudo has its own pattern now; this is the old sudo rule with its reach made unbounded, and the same mutant on a tool of today.
    ['the sudo reach made unbounded', /(?:^|[^\w.-])(?:sudo)\s(?:[^\n|;&]*\s)?(?:-[a-zA-Z]{0,4}S|--stdin)/],
    ['a tool reach made unbounded', mutant('docker|podman', '{0,200}', '*')],
    ['a JWT head made unbounded', mutant('eyJ', '{8,300}', '{8,}')],
    // Verifier HI's M-HI-1: the URL user part takes colons and both parts are unbounded. Quadratic only after `a://`.
    ['a URL user part made unbounded, with colons', mutant(':\\/\\/[^\\s/:@?#]{0,200}:', '[^\\s/:@?#]{0,200}:[^\\s/@?#]{1,200}@', '[^\\s/@?#]*:[^\\s/@?#]+@')],
    ['the bearer value made unbounded (M-V-2)', bearerMutant()],
  ]
  for (const [name, re] of mutants) {
    expect([name, superlinear([re], SMALL, LARGE, true).length]).toEqual([name, 1])
  }
  // M-V-2 is caught on the head-plus-space input loop 3 added, the input no earlier list had.
  expect(superlinear([bearerMutant()], SMALL, LARGE, true)[0]).toContain('"authorization: bearer" + " "')
  // A linear pattern on the same sizes passes.
  expect(superlinear([SECRET_PATTERNS.find(re => re.source.includes('eyJ'))!])).toEqual([])
})

/**
 * Property (UCR-087, batch M): the step gate sees a pattern that is quadratic on a run of digits or of quotes after
 * its own start: the verifier's final-v1 mutants M-D (`\d+\d*` in a --pin pattern) and M-Q (`["']*["']*` in a
 * password pattern), 458 ms on a 20k run, which passed every earlier input. And on a run of any ASCII punctuation.
 */
test('UCR-087 m087 the step check catches the digit-run and quote-run mutants, and a run of any ASCII punctuation', { timeoutMs: 120_000 }, () => {
  const md = /(?:^|\s)--pin\s{0,5}=?\s{0,5}["']?\d+\d*["']?(?:\s|$)/
  const mq = /(?:^|\s)password=["']*["']*[A-Za-z0-9]/
  // The defect behind a valid first case: each mutant is caught, on its own start and its own run.
  expect(superlinear([md], SMALL, LARGE, true)[0]).toContain('"--pin " + "1"')
  expect(superlinear([mq], SMALL, LARGE, true)[0]).toContain('"password=" + "\\""')
  // At the limit: a mutant on the last character of EXTRA_RUNS, `~`, and on the first, a digit, with no head at all.
  expect(superlinear([/(?:^|\s)token=~*~*[a-z]/], SMALL, LARGE, true)[0]).toContain('"token=" + "~"')
  expect(superlinear([/(?:^|\s)\d+\d*x/], SMALL, LARGE, true).length).toBe(1)
  // Inside the population: every ASCII punctuation character's own mutant is caught after a value name.
  const missed = EXTRA_RUNS.filter(unit => {
    const c = unit.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')

    return superlinear([new RegExp(`(?:^|\\s)key=${c}*${c}*[a-z]`)], SMALL, LARGE, true).length !== 1
  })
  expect(missed).toEqual([])
  // UCR-087 final2: a word, then `:` or `=`, then a long run of spaces (the COLON mutant).
  expect(superlinear([/password\s{0,5}:\s*\s*[a-z]/i], SMALL, LARGE, true)[0]).toContain('"password:" + " "')
  expect(superlinear([/token=\s*\s*[a-z]/i], SMALL, LARGE, true)[0]).toContain('"token=" + " "')
  // The linear forms of the same patterns pass.
  expect(superlinear([/password\s{0,5}:\s{0,5}[a-z]/i])).toEqual([])
  expect(superlinear([/(?:^|\s)--pin\s{0,5}=?\s{0,5}["']?\d{1,40}["']?(?:\s|$)/, /(?:^|\s)password=["']{0,2}[A-Za-z0-9]/])).toEqual([])
})

// ---------------------------------------------------------------- UCR-116, the IDs a hidden line keeps

test('UCR-116 a hidden line keeps only its ticket IDs, not a #word of the secret', () => {
  // The verifier's two cases: a secret that starts with #.
  expect(hideSecretLines('mysql -u root -p#Hunter2xyz #T12')).toBe('(hidden) #T12')
  expect(hideSecretLines('export db_password=#hunter2xyz')).toBe('(hidden)')
  // State 1: a valid ID first, then a secret #word.
  expect(hideSecretLines('#T0037 PGPASSWORD=x #abcdefgh psql')).toBe('(hidden) #T0037')
  // State 2: IDs at the line's limits, first and last, and in brackets. Loop 2: only the mod's #T form is kept, so `#PROJ7` goes.
  expect(hideSecretLines('#T0001 curl --password x (#T0002) #PROJ7')).toBe('(hidden) #T0001 #T0002')
  // State 3: inside the IDs: a # glued to the secret, even of an ID's form, and a word that is no ID.
  expect(hideSecretLines('pw=#T0042 #TODO #t2a export PW=x')).toBe('(hidden)')
})

// ---------------------------------------------------------------- UCR-115 and UCR-029, titles and stored text

test('UCR-115 a title is hidden when it holds a secret, its ticket IDs kept', () => {
  expect(hideTitle(undefined)).toBeUndefined()
  expect(hideTitle('Fix the parser #T0037')).toBe('Fix the parser #T0037')
  expect(hideTitle('Deploy with DB_PASSWORD=Hunter2xyz #T0037')).toBe('(hidden) #T0037')
})

test('UCR-029 a normalized line is hidden when normalize took out the _ its secret name had', () => {
  // The verifier's old stored briefs.
  expect(hideNormalizedSecretLines('fix #t0037 with mysqlpwd=hunter2xyz')).toBe('(hidden) #t0037')
  expect(hideNormalizedSecretLines('export dbpass=hunter2xyz')).toBe('(hidden)')
  // The forms hideSecretLines already sees stay hidden; a word that only ends like one does not.
  expect(hideNormalizedSecretLines('run pgpassword=hunter2 psql')).toBe('(hidden)')
  expect(hideNormalizedSecretLines('set bypass=1 and sort --key=2')).toBe('set bypass=1 and sort --key=2')
  expect(hideNormalizedSecretLines('dbauthenabled=true')).toBe('dbauthenabled=true')
})

test('UCR-087 the step ratio: a linear pattern stays near 2, a quadratic one near 4, the same on every run', { timeoutMs: 120_000 }, () => {
  // State 1: the real URL pattern on the input that makes its mutant quadratic.
  const url = SECRET_PATTERNS.find(re => re.source.includes(':\\/\\/[^\\s/:@?#]{0,200}:'))!
  expect(stepRatio(url, { head: 'a://', unit: 'x:' })).toBeLessThan(RATIO_MAX)
  // State 2: the mutant on the same input.
  const quadratic = mutant(':\\/\\/[^\\s/:@?#]{0,200}:', '[^\\s/:@?#]{0,200}:[^\\s/@?#]{1,200}@', '[^\\s/@?#]*:[^\\s/@?#]+@')
  expect(stepRatio(quadratic, { head: 'a://', unit: 'x:' })).toBeGreaterThanOrEqual(RATIO_MAX)
  // State 3: a mutant the head-less inputs miss is flagged only through a two-token input.
  expect(superlinear([quadratic], SMALL, LARGE, true)[0]).toContain('"a://"')
  // A count, not a time: two runs give the same ratio to the last digit.
  expect(stepRatio(quadratic, { head: 'a://', unit: 'x:' })).toBe(stepRatio(quadratic, { head: 'a://', unit: 'x:' }))
})

test('UCR-087 the step counter agrees with RegExp.test for every pattern on every corpus command', { timeoutMs: 120_000 }, () => {
  const commands = [...SECRET, ...PLAIN, ...MORE_SECRET, ...MORE_PLAIN, ...L2_SECRET, ...L2_PLAIN, ...J6_SECRET, ...J6_PLAIN, ...L3_SECRET, ...L3_PLAIN, ...M_SECRET, ...M_PLAIN, ...KEY_SECRET]
  const wrong: string[] = []
  for (const re of SECRET_PATTERNS) {
    const count = stepCounter(re)
    for (const command of commands) {
      if (count(command).isMatch !== re.test(command)) {
        wrong.push(`${re.source.slice(0, 40)} on ${command}`)
      }
    }
  }
  expect(wrong).toEqual([])
  // Its own edges: a case-blind negated class, a lookbehind, a lazy run, a count, a word boundary.
  for (const [re, text] of [[/[^a-z]x/i, 'Ax'], [/(?<!by)pass/, 'bypass'], [/a.*?b/, 'a__b'], [/x{2,3}y/, 'xxxxy'], [/\bkey\b/, 'a key'], [/\u2028/, 'a\u2028b']] as const) {
    expect([re.source, stepCounter(re)(text).isMatch]).toEqual([re.source, re.test(text)])
  }
})

// ---------------------------------------------------------------- UCR-180, loop 2 secret forms

test('UCR-180 every loop-2 secret form is hidden, and every plain neighbor shown', () => {
  expect(L2_SECRET.filter(command => !hasSecret(command))).toEqual([])
  expect(L2_PLAIN.filter(command => hasSecret(command))).toEqual([])
})

test('UCR-180 a new form is hidden behind a valid first command, at the far end of its reach, and next to the plain form the fix shows', () => {
  // State 1: a valid first command that is shown, then the secret form.
  expect(hasSecret('curl -b cookies.txt https://x && curl -b "sid=abc123" https://x')).toBe(true)
  expect(hasSecret('sqlplus / as sysdba; sqlplus scott/tiger@orcl')).toBe(true)
  expect(hasSecret('echo "$PW" | docker login --password-stdin; echo Hunter2xyz | docker login --password-stdin')).toBe(true)
  // State 2: at the limit of a reach: the 200 characters a short option may sit from its tool.
  expect(hasSecret(`security add-generic-password ${'-a bob '.repeat(28)}-w Hunter2xyz`)).toBe(true)
  expect(hasSecret(`xfreerdp ${'/v:host '.repeat(24)}/p:Hunter2xyz`)).toBe(true)
  // State 3: inside the population the fix shows: an option about the secret, a setting, a file.
  expect(hasSecret('npm publish --auth-type=web')).toBe(false)
  expect(hasSecret('npm publish --auth-type=web --auth hunter2')).toBe(true)
  expect(hasSecret('export AUTH_TOKEN_TTL=3600')).toBe(false)
  expect(hasSecret('export AUTH_TOKEN_TTL=3600 AUTH_TOKEN=abc')).toBe(true)
  expect(hasSecret('gh secret set API_KEY < key.txt')).toBe(false)
  expect(hasSecret('gh secret set API_KEY abc123')).toBe(true)
  expect(hasSecret('msbuild app.sln /p:Configuration=Release')).toBe(false)
})

test('UCR-180 a PEM private key hides each line of its block in long text, and the lines after it stay', () => {
  const text = ['Write the key #T0001:', '-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ', 'AAAAC3NzaC1lZDI1NTE5', '-----END OPENSSH PRIVATE KEY-----', 'Then test it'].join('\n')
  expect(hideSecretLines(text)).toBe(['Write the key #T0001:', HIDDEN, HIDDEN, HIDDEN, HIDDEN, 'Then test it'].join('\n'))
  // A block with no END line hides to the end of the text.
  expect(hideSecretLines('-----BEGIN RSA PRIVATE KEY-----\nMIIEow')).toBe(`${HIDDEN}\n${HIDDEN}`)
  // A public key is no secret.
  expect(hideSecretLines('-----BEGIN PUBLIC KEY-----\nMIIBIj')).toBe('-----BEGIN PUBLIC KEY-----\nMIIBIj')
})

// ---------------------------------------------------------------- UCR-183, the flag-value guard (mutant M01)

test('UCR-183 a flag value after a secret name is shown, and a real value next to it is hidden', () => {
  // State 1: the flag words the VALUE rule names, after a long and a short secret name.
  for (const text of ['export DB_PASSWORD=false', 'TOKEN: null', 'export API_KEY=none', 'export PW=off', 'export DB_PASSWORD="false"']) {
    expect([text, hasSecret(text)]).toEqual([text, false])
  }
  // State 2: at the limit of a flag word: a longer word that only starts like one is a value.
  for (const text of ['export DB_PASSWORD=falsehood', 'TOKEN: nullable9', 'export PW=offline1']) {
    expect([text, hasSecret(text)]).toEqual([text, true])
  }
  // State 3: a flag value first, then a secret value.
  expect(hasSecret('export DB_PASSWORD=false TOKEN=abc')).toBe(true)
})

test('UCR-116 a #word after a space, a bracket or a comma on a hidden line is dropped unless it is a #T ID', () => {
  // The reviewer's and the verifier's cases.
  expect(hideSecretLines('mysql -u root --password #Hunter2')).toBe('(hidden)')
  expect(hideSecretLines('docker login -u bob -p #Summer2024')).toBe('(hidden)')
  expect(hideSecretLines('sshpass -p #Winter99 ssh host')).toBe('(hidden)')
  // State 1: a valid #T ID first, then a #word secret after a bracket and a comma.
  expect(hideSecretLines('#T0037 PW=(#hunter2) PW=[#ab12] pw=x,#ab12')).toBe('(hidden) #T0037')
  // State 2: at the limits of the ID form: a short old ID, a long new one, and one with a lower-case letter.
  expect(hideSecretLines('PW=x #T12 #T002B #T002b')).toBe('(hidden) #T12 #T002B')
  // State 3: inside the forms the parser takes as IDs but the mod never writes.
  expect(hideSecretLines('PW=x #PROJ7 #abc1 #A2')).toBe('(hidden)')
  // Text normalize changed keeps its lower-case IDs.
  expect(hideNormalizedSecretLines('fix #t0037 #t1 with mysqlpwd=hunter2xyz #hunter2')).toBe('(hidden) #t0037 #t1')
})

// ---------------------------------------------------------------- loop 3 (batch L6): R6's corpus, attached options, continued lines

const PW3 = 'Zebra9Quill'

test('UCR-242 an attached short option is hidden for each tool whose parser takes one', () => {
  // R6's twelve attached forms (attached.ts), and the spaced form of each.
  const forms = [`az login -u bob -p${PW3}`, `sqlcmd -S h -U sa -P${PW3}`, `bcp t out f -U sa -P${PW3}`, `ldapsearch -x -D cn=a -w${PW3}`, `cqlsh -u bob -p${PW3} h`, `twine upload -u bob -p${PW3} dist/*`, `doctl auth init -t${PW3}`, `http -abob:${PW3} https://x`, `influx query -t${PW3} 'q'`, `gh secret set X -b${PW3}`, `curl -ubob:${PW3} https://x`, `redis-cli -a${PW3} ping`]
  for (const form of forms) {
    // The spaced form: a space after the option's letter.
    const spaced = form.replace(/ (-[a-zA-Z])(?=\S)/, ' $1 ')
    expect([form, hasSecret(form), spaced, hasSecret(spaced)]).toEqual([form, true, spaced, true])
  }
  // Every Bash surface hides it: the title, the summary and the detail.
  const command = `curl -ubob:${PW3} https://api.example/x`
  expect([describeCall('Bash', { command }), callSummary('Bash', { command }), callDetail('Bash', { command }, 'x')]).toEqual([`Bash: ${HIDDEN}`, `Bash: ${HIDDEN}`, HIDDEN])
})

test('UCR-242 an attached option is hidden behind a valid first command, at the far end of its reach, and next to the options the fix shows', () => {
  // State 1: a valid first command, then the attached form.
  expect(hasSecret(`ls -la && ldapwhoami -x -D cn=admin,dc=x -w${PW3}`)).toBe(true)
  // State 2: 195 characters of other options before it, inside the 200 a short option may sit from its tool.
  expect(hasSecret(`sqlcmd ${'-S h '.repeat(39)}-P${PW3}`)).toBe(true)
  // State 3: inside the population the fix shows: InfluxDB 1.x's `-type` and curl's `--user-agent`.
  expect(hasSecret('influx -type flux -execute q')).toBe(false)
  expect(hasSecret(`influx -type flux -t${PW3}`)).toBe(true)
  expect(hasSecret('curl --user-agent "Mozilla/5.0" https://x')).toBe(false)
  expect(hasSecret(`curl --user-agent "Mozilla/5.0" -ubob:${PW3} https://x`)).toBe(true)
  expect(hasSecret('curl -b cookies.txt https://x')).toBe(false)
  expect(hasSecret('curl -bsid=abc123 https://x')).toBe(true)
})

test('UCR-243 every form of the J6 and loop-3 corpora is hidden, and every ordinary neighbor shown', () => {
  expect(J6_SECRET.length).toBe(40)
  expect(L3_SECRET.length).toBe(40)
  expect([...J6_SECRET, ...L3_SECRET].filter(command => !hasSecret(command))).toEqual([])
  expect([...J6_PLAIN, ...L3_PLAIN].filter(command => hasSecret(command))).toEqual([])
  // R6's ten positional and stdin forms (l3-corpus.ts), by name.
  for (const command of [`mysqladmin -u root password ${PW3}`, `smbclient //srv/share ${PW3} -U bob`, `p4 -u bob -P ${PW3} sync`, `ncftp -u bob -p ${PW3} ftp.example`, `ftp -n ftp.example <<< "user bob ${PW3}"`, `echo -n ${PW3} | docker secret create db_pw -`, `wrangler secret put API_KEY <<< ${PW3}`, `vercel env add API_TOKEN production <<< ${PW3}`, `doppler secrets set PAY_KEY ${PW3}`, `ansible-vault view --vault-password-file <(echo ${PW3}) vault.yml`]) {
    expect([command, hasSecret(command)]).toEqual([command, true])
  }
})

test('UCR-243 a positional form is hidden behind a valid first command, at the far end of its reach, and next to the forms the fix shows', () => {
  // State 1: a valid first command of the same tool that holds none.
  expect(hasSecret(`doppler secrets get API_KEY --plain && doppler secrets set API_KEY ${PW3}`)).toBe(true)
  // State 2: 180 characters of options between the tool and its form.
  expect(hasSecret(`rabbitmqctl ${'-q '.repeat(60)}add_user bob ${PW3}`)).toBe(true)
  // State 3: inside the population the fix shows: a prompt for the password, a path option, a literal fed to a plain command.
  expect(hasSecret('bw unlock --raw')).toBe(false)
  expect(hasSecret(`bw unlock --raw; bw unlock ${PW3}`)).toBe(true)
  expect(hasSecret('cf push -p ./app')).toBe(false)
  expect(hasSecret(`cf push -p ./app && cf login -a api.x -u bob -p ${PW3}`)).toBe(true)
  expect(hasSecret('diff <(echo a) <(echo b)')).toBe(false)
  expect(hasSecret(`diff <(echo a) <(echo b); app --token-file <(echo ${PW3})`)).toBe(true)
  expect(hasSecret('echo "$PW" | docker secret create db_pw -')).toBe(false)
})

test('UCR-001 PGP, PuTTY, SSH2 key blocks and age keys are hidden, each body line too, and the lines after a block stay', () => {
  for (const text of KEY_SECRET) {
    expect([text, hasSecret(text)]).toEqual([text, true])
    expect(hideSecretLines(text).includes(KEY_BODY)).toBe(false)
  }
  // The line after each block stays (`EOF`), so only the block is hidden.
  expect(hideSecretLines(KEY_SECRET[0]!).split('\n').at(-1)).toBe('EOF')
  expect(hideSecretLines(KEY_SECRET[1]!).split('\n').at(-1)).toBe('EOF')
  expect(hideSecretLines(KEY_SECRET[2]!)).toBe(['cat > k <<EOF', HIDDEN, HIDDEN, HIDDEN, HIDDEN, 'EOF'].join('\n'))
  // A public key block is no secret.
  expect(hasSecret('---- BEGIN SSH2 PUBLIC KEY ----\nAAAAB3NzaC1yc2E')).toBe(false)
})

test('UCR-247 a key type of two or three words before PRIVATE KEY still opens a block (kills N34)', () => {
  // N34 cut the words before PRIVATE KEY to one: these types have two and three.
  for (const begin of ['---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----', '-----BEGIN DSA ENCRYPTED PRIVATE KEY-----', '-----BEGIN A B C PRIVATE KEY-----']) {
    expect([begin, hideSecretLines(`${begin}\n${KEY_BODY}\nafter`)]).toEqual([begin, `${HIDDEN}\n${HIDDEN}\n${HIDDEN}`])
  }
})

test('UCR-244 a command continued with a backslash is checked as one line, in steps, claims, titles and descriptions', () => {
  // R6's four continued commands (l3-corpus.ts), and the step, claim, title and description of cont-step.ts.
  const cmd = `mysql -h db -u root \\\n  -p${PW3} app`
  expect(hasSecret(cmd)).toBe(true)
  expect(readProgress({ done: 1, total: 2, step: `run ${cmd}` })?.step).toBe(`${HIDDEN}\n${HIDDEN}`)
  expect(readClaims({ items: [`#T0037 ${cmd}`] })).toEqual([`${HIDDEN} #T0037\n${HIDDEN}`])
  expect(hideTitle(`Deploy: ${cmd}`)).toBe(`${HIDDEN}\n${HIDDEN}`)
  expect(hideSecretLines(`docker login r -u bob \\\n  -p ${PW3}`)).toBe(`${HIDDEN}\n${HIDDEN}`)
  // State 1: a valid first line, then the continued command; the first line stays.
  expect(hideSecretLines(`Run this:\nsshpass \\\n  -p ${PW3} ssh host`)).toBe(`Run this:\n${HIDDEN}\n${HIDDEN}`)
  // State 2: at the far end: the option on the third line of the command, and a CRLF break.
  expect(hideSecretLines(`sqlcmd -S db \\\n  -U sa \\\n  -P ${PW3}`)).toBe(`${HIDDEN}\n${HIDDEN}\n${HIDDEN}`)
  expect(hasSecret(`sqlcmd -S db -U sa \\\r\n  -P ${PW3}`)).toBe(true)
  // State 3: inside the population the fix shows: a plain continued command, and a line after the hidden one.
  expect(hideSecretLines('echo a \\\n  b')).toBe('echo a \\\n  b')
  expect(hideSecretLines(`curl https://x \\\n  -H "Authorization: Bearer ${PW3}"\nls`)).toBe(`${HIDDEN}\n${HIDDEN}\nls`)
})

test('UCR-200 a .pgpass line is hidden only as a whole token of five fields: MAC addresses, IPv6 and times stay shown', () => {
  // The verifier's and R6's ordinary commands (fp3.ts).
  for (const text of ['sudo ifconfig en0 ether 00:11:22:33:44:55', 'ip link set dev eth0 address 02:42:ac:11:00:02', 'ping6 2001:4860:4860:0000:0000:0000:0000:8888', 'arp -s 10.0.0.9 00:1a:2b:3c:4d:5e', 'echo 12:30:45:67:89', 'ping6 fe80:0:0:0:200:f8ff:fe21:67cf%en0']) {
    expect([text, hasSecret(text)]).toEqual([text, false])
  }
  // State 1: a shown address first, then a .pgpass line.
  expect(hasSecret(`ping6 2001:db8::1 && echo "db:5432:app:bob:${PW3}" >> ~/.pgpass`)).toBe(true)
  // State 2: at the limit: five fields end the token; a sixth makes it no .pgpass line.
  expect(hasSecret(`h:5432:db:u:${PW3}`)).toBe(true)
  expect(hasSecret(`h:5432:db:u:${PW3}:x`)).toBe(false)
  // State 3: inside the population the fix shows (a bare-number host), a named host still counts.
  expect(hasSecret('echo 10:5432:db:u:pw')).toBe(false)
  expect(hasSecret('echo localhost:5432:*:postgres:89')).toBe(true)
  expect(hasSecret('echo *:*:*:bob:pw')).toBe(true)
})

test('UCR-246 a space after = ends the value unless a quote follows or a space came before', () => {
  expect(hasSecret('grep -n DB_PASSWORD= .env.example')).toBe(false)
  // State 1: a bare name first, then a real value.
  expect(hasSecret(`grep -n DB_PASSWORD= .env && export DB_PASSWORD=${PW3}`)).toBe(true)
  // State 2: at the limit: a quote after five spaces is a value; a bare word after spaces is none.
  expect(hasSecret(`PW=     "${PW3}"`)).toBe(true)
  expect(hasSecret(`PW=  ${PW3}`)).toBe(false)
  // State 3: inside the forms the fix keeps: spaces both sides (ini, Python), and `:` (YAML).
  expect(hasSecret(`password = ${PW3}`)).toBe(true)
  expect(hasSecret(`API_KEY = ${PW3}`)).toBe(true)
  expect(hasSecret(`password: ${PW3}`)).toBe(true)
})

test('UCR-201 a flag word counts only when it is the whole value', () => {
  // flag183.ts: the values that only start like a flag word.
  for (const text of ['PASSWORD=yes!Hunter2', 'PASSWORD=none@2024', 'PASSWORD=Off#Road99', 'API_TOKEN=null+abc123', 'PASSWORD=on/off99', 'export DB_PASSWORD=True$ecret9', 'PASSWORD=no:way2x', 'PASSWORD=true-Hunter2']) {
    expect([text, hasSecret(text)]).toEqual([text, true])
  }
  // State 1: a flag value first, then one that only starts like a flag word.
  expect(hasSecret('export DB_PASSWORD=false PASSWORD=yes!x')).toBe(true)
  // State 2: at the limit: a flag word ended by a comma, a bracket, a quote or the end is a flag.
  expect(hasSecret('{"token": null, "password": false}')).toBe(false)
  expect(hasSecret('f(password=None)')).toBe(false)
  // State 3: inside the flags the fix shows, case and quotes kept.
  expect(hasSecret('DB_PASSWORD=False')).toBe(false)
  expect(hasSecret('DB_PASSWORD="false"')).toBe(false)
})

test('UCR-116 both paths keep only an ID the mod gives a value: at most 6 characters after the T', () => {
  // p116b.ts: the raw path drops `#T0037abc`; the normalized path now drops `#t0037abc` too.
  expect(hideSecretLines('PW=x #T0037abc')).toBe(HIDDEN)
  expect(hideNormalizedSecretLines('pw=x #t0037abc')).toBe(HIDDEN)
  // State 1: a valid ID first, then a long one.
  expect(hideNormalizedSecretLines('pw=x #t0037 #t20241005')).toBe(`${HIDDEN} #t0037`)
  // State 2: at the limit: six characters after the T are kept on both paths, seven are not.
  expect(hideSecretLines('PW=x #T0037AB #T0037ABC')).toBe(`${HIDDEN} #T0037AB`)
  expect(hideNormalizedSecretLines('pw=x #t0037ab #t0037abc')).toBe(`${HIDDEN} #t0037ab`)
  // State 3: inside the IDs: a value past the end of the number line is a plain word.
  expect(hideSecretLines('PW=x #T9ZZZZ')).toBe(HIDDEN)
})

test('UCR-247 a # glued to a secret in normalized text is not kept as an ID (kills N31)', () => {
  // N31 took out the lookbehind of KEPT_NORMALIZED_ID: `-p#t0037` would keep `#t0037`.
  expect(hideNormalizedSecretLines('mysql -p#t0037 db')).toBe(HIDDEN)
  expect(hideNormalizedSecretLines('export pw=x#t0042')).toBe(HIDDEN)
  expect(hideNormalizedSecretLines('mysql -px #t0037')).toBe(`${HIDDEN} #t0037`)
})

test('UCR-116 an ID that is the secret value is not kept on the hidden line; the other IDs are', () => {
  expect(hideSecretLines('curl --password #T0037ABC https://x')).toBe('(hidden)')
  expect(hideSecretLines('export DB_PASSWORD=#T1A2B #T0005')).toBe('(hidden) #T0005')
  expect(hideNormalizedSecretLines('dbpass=#t0037ab #t0001')).toBe('(hidden) #t0001')
  // A control: IDs next to a secret stay.
  expect(hideSecretLines('#T0001 curl --password x (#T0002)')).toBe('(hidden) #T0001 #T0002')
})
