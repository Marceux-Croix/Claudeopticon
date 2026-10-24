/** Secret detection: the patterns, and the text with secrets hidden. */

import { ticketValue } from './ticket-ids'

/**
 * The rule. A text holds a secret when it has one of these forms:
 * 1. A long option whose name has a secret word: `--password`, `--with-token`, `--api-key`,
 *    `--client-secret`, `--auth`, `--src-creds`, `--account-key`, `--oauth2-bearer`, the word glued on
 *    or in camelCase (`--dbpassword`, `--accessToken`, `--clientSecret`, `--secretKey`), and the
 *    single-dash `-pass`, `-passwd`, `-passin`, `-storepass` forms. An option about the secret, not the
 *    secret, stays shown: `--auth-type=web`, `--password-stdin`, `--token-file` (OPTION_SETTINGS),
 *    unless a literal is fed to it: `--vault-password-file <(echo pw)`.
 *    PowerShell and Windows forms count too: `-Password x`, `-NuGetApiKey x`, `-ApiKey x`,
 *    `ConvertTo-SecureString "x"`, `cmdkey /pass:x`.
 * 2. A short option that takes a secret, for the tools in SHORT_OPTIONS only (`mysql -pX`,
 *    `docker login -p`, `az login -p`, `sqlcmd -P`, `ldapsearch -w`, `smbclient -U u%p`, `curl -b a=b`,
 *    `security add-generic-password -w`, `redis-cli AUTH pw`, `nmcli ... password`, `xfreerdp /p:`,
 *    `lftp -u u,p` and more),
 *    attached to its value too where the tool's parser takes that (`sqlcmd -PX`, `curl -ubob:pw`,
 *    ), `isql -P` (Sybase), `security unlock-keychain -p`, and the tools that take one as a plain
 *    argument: `sqlplus u/p@db` (and `expdp`, `impdp`, `exp`, `imp`), `wpa_passphrase ssid pw`,
 *    `net use \\h\s pw`, `cargo login tok`, `ngrok config add-authtoken tok`, `mysqladmin password pw`,
 *    `smbclient //h/s pw`, `rabbitmqctl add_user u pw`, `bw unlock pw`, `isql dsn u pw`,
 *    `doppler secrets set NAME v`.
 *    A short option alone means many things, so it counts only after its own tool, in the same
 *    command. `sudo -S` counts only as an option of sudo itself, before the command it runs.
 * 3. An assignment with a value (`NAME=v`, `NAME: v` or a JSON `"name": "v"`) to a name with a long
 *    secret word in it (password, passphrase, secret, token, api key, access key, private key, the
 *    two-word ones also with a hyphen or a space between the words, credential, AccountKey), or with a short one as a whole `_` part (`PW=`, `DB_PWD=`, `pass=`,
 *    `auth=`, `GH_PAT=`, `CREDS=`, `SSH_KEY=`). A name alone is no secret: `grep "password:"`, `TOKEN=`
 *    and `grep DB_PASSWORD= .env` (a space after `=` with no quote after it ends the value)
 *    stay shown, and so do a count (`max_tokens`), a flag value that is the whole value
 *    (`DB_PASSWORD=false`, `TOKEN: null`; `PASSWORD=yes!x` is a value), a setting about the
 *    secret (`AUTH_MODE=`, `AUTH_TOKEN_TTL=`, `SSH_AUTH_SOCK=`) and a data key (`SORT_KEY=`,
 *    `PRIMARY_KEY=`). A key in brackets counts: `os.environ["PW"] = x`. So do SQL forms:
 *    `IDENTIFIED BY 'x'`, `PRAGMA key = 'x'`.
 * 4. A credential header with a value (`Authorization: Bearer x`, `Cookie: a=b`, `X-Auth-Token: x`,
 *    `Ocp-Apim-Subscription-Key: x`, `DD-API-KEY: x`, `x-functions-key: x`), or `curl -u user:` with a
 *    name that is not a number, or `curl -u :token` with no user, or a password after a name or a file
 *    (`--proxy-user u:pw`, `--cert c.pem:pw`). The words
 *    "bearer" and "basic" alone (in a commit message) are no secret.
 * 5. A URL that carries one: a token-length user name in an http(s) URL (`https://ghp_x@`), any
 *    `user:pass@` or `:pass@` in a URL, a query or fragment value such as `access_token=`, `key=` or `X-Amz-Signature=`,
 *    or a webhook URL (Slack, Discord, Teams). A short user (`https://bob@host`) is a user, not a token.
 * 6. A known token shape: GitHub, GitLab, OpenAI and Anthropic `sk-`, payment `sk_live_`, Slack, AWS, Google,
 *    npm, Vault, PyPI, DigitalOcean, Shopify, Hugging Face `hf_`, SendGrid `SG.`, age `AGE-SECRET-KEY-1`,
 *    Docker Hub `dckr_pat_`, Google OAuth `ya29.` and `1//0`, Mailgun `key-` and Twilio `SK` with 32 hex digits,
 *    JWTs, and a private key block: PEM and PGP (`-----BEGIN ... PRIVATE KEY-----`,
 *    `-----BEGIN PGP PRIVATE KEY BLOCK-----`), SSH2 (RFC 4716, `---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----`)
 *    and PuTTY (`PuTTY-User-Key-File-3:` to `Private-MAC:`).
 * 7. A value fed in another way: a secret setting set by name (`aws configure set
 *    aws_secret_access_key v`, `npm set _auth v`, `yarn config set npmAuthToken v`,
 *    `redis-cli config set requirepass v`; a value read from a file, `< key.txt`, stays shown),
 *    a here-string into a login or a secret store (`kinit <<< pw`, `op signin <<< pw`,
 *    `ftp <<< "user u pw"`, `wrangler secret put X <<< v`), `echo user:pass | base64`,
 *    a literal echoed into a password reader (`| passwd --stdin`, `| chpasswd`, `| docker login
 *    --password-stdin`, `| smbpasswd -s`, `| docker secret create x -`; `echo $PW |` names a variable
 *    and stays shown), a `.netrc` line, a `.pgpass` line (`host:5432:db:user:pw`, the whole token: a
 *    MAC address or an IPv6 address is none), and the value options of secret stores
 *    (`gh secret set --body`, `az keyvault secret set --value`, `aws ssm put-parameter --value`,
 *    `kubectl create secret --from-literal`).
 * The word "secret" alone (`kubectl get secrets`, `import secrets`) is no secret.
 *
 * A command continued with a backslash at the end of a line is one command: the check joins its
 * lines first, so an option on the next line counts.
 *
 * A match hides the whole detail. A false positive only hides a harmless line, so the list errs
 * wide; plain commands (`mkdir -p`, `git log -p`, `docker run -u 1000:1000`, `psql -p 5432`) stay.
 * tests/fixtures/secret-corpus.ts holds the commands each side must give.
 *
 * Every quantifier is bounded (at most a few hundred characters), and each pattern starts at a
 * fixed word or a non-word boundary, so a check is linear in the text: a 100,000-character command
 * never blocks `tool.call`. An unbounded `*` before a later literal is quadratic.
 * tests/fixtures/pattern-growth.ts counts the backtracking steps of each pattern to hold this.
 */

/** The flag words a value may be: a value that is exactly one of them (`false`, `"null"`) is no secret (`DB_PASSWORD=false`). */
const FLAG_WORDS = 'true|false|yes|no|on|off|none|null|nil|undefined|enabled|disabled'

/**
 * The start of a value: a quote at most, then a character that starts a value, and not a flag word
 * that is the whole value (`PASSWORD=yes!Hunter2` is a value that starts like one).
 */
const VALUE = `["']?(?!(?:${FLAG_WORDS})["']?(?=[\\s,;)}\\]&|]|$))[^\\s"']`

/**
 * An `=` before a value: no space after it, unless a quote follows (`PW= "x"`) or there is
 * a space before it too (`password = x`, the form of an ini or a Python line). `grep DB_PASSWORD= .env`
 * names the variable: the next argument is no value of it.
 */
const EQUALS = `(?:\\s{1,5}=\\s{0,5}|=(?:\\s{1,5}(?=["']))?)`

/** A `:` before a value: spaces either side, as YAML and JSON write it (`password: x`, `"token": "x"`). */
const COLON = `\\s{0,5}:\\s{0,5}`
/** After `token:` and the like, a word of prose is no value: `token: see vault`, `password: in the keychain`. */
const PROSE = `(?!(?:see|in|from|the|is|are|not|stored|kept|at|via|with|ask|use)\\s)`

/** A value as plain arguments give one: a quote at most, then no option, redirect or pipe. */
const ARG = `["']?[^\\s"'<|>-]`


/** Tools whose short options take a secret: the tool name (a regex source) and the options, case kept. */
const SHORT_OPTIONS: readonly (readonly [tool: string, option: string])[] = [
  // A lone `-p` makes mysql ask for the password: only the attached form holds one.
  ['mysql\\w{0,20}|mariadb\\w{0,20}', '-p\\S'],
  // `mysqladmin password pw` sets a new one.
  ['mysqladmin', `password\\s{1,5}${ARG}`],
  ['mongo\\w{0,20}', '-p'],
  ['(?:docker|podman|buildah|skopeo|nerdctl|oras|helm\\s{1,5}registry)\\s{1,5}login', '-p'],
  // OpenShift, crane and Cloud Foundry: `login -u bob -p pw`. Only after login: `cf push -p` is a path.
  ['oc\\s{1,5}login|crane\\s{1,5}auth\\s{1,5}login|cf\\s{1,5}(?:login|auth)', '-p'],
  // `az login` and `az acr login`: `-p` is the password.
  ['az(?:\\s{1,5}[a-z-]{1,20}){0,2}\\s{1,5}login', '-p'],
  ['sshpass', '-p'],
  ['redis-cli', '-a'],
  // `AUTH pw` or `AUTH user pw`, the command typed after the options.
  ['redis-cli', `(?:AUTH|auth)\\s{1,5}${ARG}`],
  ['zip|unzip', '-P'],
  ['7z\\w{0,2}', '-p\\S'],
  // `-p-` tells unrar there is no password.
  ['unrar|rar', '-p[^\\s-]'],
  // `-k <pass>` or `-K <hex key>`; `-key <file>` is a path.
  ['openssl', '-[kK](?=\\s|$)'],
  ['ssh-keygen', '-[a-zA-Z]{0,4}[NP]'],
  ['htpasswd', '-[a-zA-Z]{0,4}b'],
  // These parsers (getopt, argparse, pflag) take a value attached as well as after a space, so the
  // option alone counts: `sqlcmd -PX`, `ldapsearch -wX`, `doctl -tX`.
  // Sybase and SAP ASE `isql -U sa -P pw` too (unixODBC's isql has no `-P`; its form is below).
  ['sqlcmd|bcp|mssql-cli|tsql|ipmitool|p4|isql', '-P'],
  // `-W` asks for the password; `-w` gives it.
  ['ldap\\w{1,20}', '-w'],
  ['cqlsh|twine|rabbitmqadmin|ncftp\\w{0,5}', '-p'],
  ['doctl', '-t'],
  // InfluxDB 1.x has single-dash long options: `-type flux` is no token.
  ['influx\\w{0,5}', '-t(?!ype(?![\\w-]))'],
  // HTTPie and xh: `-a user:pass`.
  ['https?|xh', '-a'],
  // SNMP: `-A` and `-X` are the v3 passphrases, `-c` the v1 and v2c community.
  ['snmp\\w{1,20}', '-[AXc]'],
  // `user%pass` is how Samba tools take both; `-U user` alone asks.
  ['smbclient|rpcclient|smbmap|smbcacls', `(?:-U\\s{1,5}|--user=)["']?[^\\s%"']{1,100}%[^\\s"']`],
  // `smbclient //host/share pw`: the password after the service.
  ['smbclient', `(?:\\/\\/|\\\\\\\\)\\S{1,200}\\s{1,5}${ARG}`],
  // `-u 1000:1000` is a user and group; a name before the colon is a user and its password.
  // An empty user (`-u :token`) is a token alone. `-ubob:pw` is attached.
  ['curl', `(?:-u(?:\\s{1,5}|=)?|--user(?:\\s{1,5}|=))["']?(?:(?!\\d{1,10}:)[^\\s:"']{1,200}:|:[^\\s"'])`],
  // `-b a=b` is cookie data; `-b cookies.txt` is a file and stays shown.
  ['curl', `(?:-b(?:\\s{1,5}|=)?|--cookie(?:\\s{1,5}|=))["']?[^\\s"'=]{1,200}=`],
  ['etcdctl', `--user(?:\\s{1,5}|=)["']?[^\\s:"']{1,200}:[^\\s"']`],
  // macOS keychain: `-w pw`; a lone `-w` asks.
  ['security\\s{1,5}add-[a-z]{1,20}-password', `-w\\s{1,5}["']?[^\\s"'-]`],
  // `security unlock-keychain -p pw`, `create-keychain -p pw`, `set-keychain-password -o old -p new`; with no `-p` it asks.
  ['security\\s{1,5}(?:unlock-keychain|create-keychain|set-keychain-password)', `-[po]\\s{1,5}["']?[^\\s"'-]`],
  ['nmcli', `(?:password|wifi-sec\\.psk|802-11-wireless-security\\.psk)\\s{1,5}["']?[^\\s"']`],
  ['networksetup', `-setairportnetwork\\s{1,5}\\S{1,100}\\s{1,5}(?:"[^"]{1,100}"|'[^']{1,100}'|\\S{1,100})\\s{1,5}["']?[^\\s"']`],
  ['ngrok', `(?:add-)?authtoken\\s{1,5}["']?[^\\s"'-]`],
  // `cargo login` alone reads the token from stdin.
  ['cargo', `login\\s{1,5}["']?[^\\s"'<|-]`],
  // FreeRDP: `/p:pw`. Only after its own tool: `msbuild /p:Configuration=Release` is a property.
  ['[xw]?freerdp\\d{0,2}|wlfreerdp', '/p:\\S'],
  // `-p -` reads the password from stdin.
  ['rdesktop', '-p\\s{0,5}[^\\s-]'],
  ['mosquitto_(?:pub|sub|rr)', '(?:-P|--pw)(?=[\\s=]|$)'],
  // `mosquitto_passwd -b file user pw`.
  ['mosquitto_passwd', `-b\\s{1,5}\\S{1,200}\\s{1,5}\\S{1,100}\\s{1,5}${ARG}`],
  ['lftp', `-u\\s{1,5}["']?[^\\s,"']{1,100},[^\\s"']`],
  // Users made with their password: `rabbitmqctl add_user u pw`, `mc admin user add alias u pw`.
  ['rabbitmqctl', `(?:add_user|change_password)\\s{1,5}\\S{1,100}\\s{1,5}${ARG}`],
  ['mc\\s{1,5}admin\\s{1,5}user', `add\\s{1,5}\\S{1,100}\\s{1,5}\\S{1,100}\\s{1,5}${ARG}`],
  ['grafana-cli', `reset-admin-password\\s{1,5}${ARG}`],
  // Bitwarden: `bw unlock pw`, `bw login user pw`; with no password it asks.
  ['bw', `(?:unlock|login\\s{1,5}[^\\s-]\\S{0,200})\\s{1,5}${ARG}`],
  // unixODBC: `isql DSN user pw`.
  // A redirect is no DSN or user: `isql -b dsn < query.sql` has no password.
  ['isql', `[^\\s<>|-]\\S{0,100}\\s{1,5}[^\\s<>|-]\\S{0,100}\\s{1,5}${ARG}`],
  // `qpdf --encrypt user-pw owner-pw 256`.
  ['qpdf', `--encrypt\\s{1,5}["']?[^\\s"'-]`],
  // The value options of secret stores.
  ['gh\\s{1,5}secret\\s{1,5}set', '(?:-b|--body(?=[\\s=]|$))'],
  ['az\\s{1,5}keyvault\\s{1,5}secret\\s{1,5}set', '--value(?=[\\s=]|$)'],
  ['aws\\s{1,5}ssm\\s{1,5}put-parameter', '--value(?=[\\s=]|$)'],
  ['kubectl\\s{1,5}create\\s{1,5}secret', '--from-literal(?=[\\s=]|$)'],
  // A secret store that takes NAME VALUE: `doppler secrets set KEY v`, `glab variable set KEY v`.
  ['doppler\\s{1,5}secrets\\s{1,5}set|glab\\s{1,5}variable\\s{1,5}set', `[A-Za-z_]\\w{0,100}\\s{1,5}${ARG}`],
  ['glab\\s{1,5}variable\\s{1,5}set', `(?:-v|--value)(?:\\s{1,5}|=)${ARG}`],
]

/** The option of a listed tool, in the same simple command (no newline, pipe, `;` or `&` between). */
const shortOption = ([tool, option]: readonly [string, string]): RegExp => new RegExp(`(?:^|[^\\w.-])(?:${tool})\\s(?:[^\\n|;&]{0,200}\\s)?(?:${option})`)

/** The words after a `_` secret name that make it a setting about the secret, not the secret: `AUTH_MODE=`, `PASS_FILE=`. */
const SETTING_PARTS = 'enabled?|disabled?|mode|type|method|methods|provider|url|uri|host|port|file|path|dir|user|username|name|header|required|timeout|ttl|scheme|domain|realm|endpoint|server|backend|plugin|strategy|flow|level|policy|length|min|max|count|sock|socket'

/**
 * The words after a long option's secret word that make it an option about the secret:
 * `--auth-type=web`, `--password-stdin`, `--token-file x`. Narrower than SETTING_PARTS: `--auth-user`
 * or `--auth-header` may carry the secret itself, and `--token-code` is a one-time code.
 */
const OPTION_SETTINGS = 'type|method|mode|stdin|file|path|dir|url|uri|length|ttl|timeout|provider|scheme|plugin|required'

/** The words before `_KEY` that make it a data key, not a secret: `SORT_KEY=`, `PRIMARY_KEY=`. */
const DATA_KEYS = 'sort|primary|foreign|partition|cache|group|order|range|index|lookup|unique|composite|shard|row|dedup|cluster|routing|idempotency|public|pub|cursor|natural|surrogate|join|map|hash|dict|object|item|config|cfg|label|i18n|translation|message|msg|feature|flag|s3|blob|column|field|sequence|seq'

/** The secret settings a config tool sets by name, the value after a space: `aws configure set aws_secret_access_key v`. */
const SETTING_NAMES = '(?:aws_)?secret_access_key|aws_session_token|session_token|access_token|refresh_token|auth_?token|client_secret|secret_key|api_?key|private_key|_auth(?:token)?|_password|password|passwd|token|npm_?auth_?(?:token|ident)|requirepass|masterauth'

/**
 * The first line of a private key block: PEM (`-----BEGIN OPENSSH PRIVATE KEY-----`, up to three
 * words before PRIVATE), PGP (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) and SSH2 (RFC 4716:
 * `---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----`).
 */
const PEM_BEGIN = /-{4,5} ?BEGIN (?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY(?: BLOCK)? ?-{4,5}/
const PEM_END = /-{4,5} ?END (?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY(?: BLOCK)? ?-{4,5}/

/** The first and last lines of a PuTTY key file: the private lines are between them, with no mark of their own. */
const PPK_BEGIN = /PuTTY-User-Key-File-\d{1,2}:/
const PPK_END = /Private-MAC:/

/** The key blocks whose every line is hidden, from the line that opens one to the line that closes it. */
const KEY_BLOCKS: readonly { begin: RegExp; end: RegExp }[] = [
  { begin: PEM_BEGIN, end: PEM_END },
  { begin: PPK_BEGIN, end: PPK_END },
]

/** Every form of the rule above, each linear in the text. Exported for the growth test. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  // 1. Long and single-dash options.
  new RegExp(`--(?:[a-z0-9]{1,20}[-_]){0,4}(?:pass(?:w(?:or)?d|phrase)?|pwd|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|account[-_]?key|sse-c-key|(?:encryption|master|signing|shared|storage|subscription|sas)[-_]?key|credentials?|creds?|auth|bearer)(?![a-z])(?![-_](?:${OPTION_SETTINGS})(?![a-z0-9]))`, 'i'),
  // The secret word glued to a prefix (`--dbpassword`, `--authtoken`) or in camelCase (`--accessToken`, `--clientSecret`).
  new RegExp(`--[a-z0-9]{1,20}(?:password|passwd|passphrase|pwd|token|secret)(?![a-z])(?![-_](?:${OPTION_SETTINGS})(?![a-z0-9]))`, 'i'),
  new RegExp(`--(?=[a-z])[a-zA-Z0-9]{0,40}(?:Pass(?:w(?:or)?d|phrase)?|Pwd|Token|Secret|Credentials?|Creds?|Auth|(?:[Aa]pi|[Aa]ccess|[Pp]rivate|[Ss]ecret|[Aa]ccount|[Cc]lient)Key)(?![a-z])(?![-_](?:${OPTION_SETTINGS})(?![a-z0-9]))`),
  /(?:^|\s)-(?:pass(?:in|out|word|phrase|wd)?|(?:store|key|srcstore|deststore)pass)(?=[\s=:]|$)/,
  // PowerShell and nuget options, any case, with a value: `-Password x`, `-NuGetApiKey x`, `-ApiKey x`.
  /(?:^|\s)-(?:password|passphrase|(?:nuget)?apikey|accesstoken|authtoken|clientsecret)(?:\s{1,5}|\s{0,5}[:=]\s{0,5})["']?[^\s"'-]/i,
  /(?:^|[^\w-])convertto-securestring(?:\s{1,5}-string)?\s{1,5}["']?[^\s"'$-]/i,
  // Windows: `cmdkey /pass:pw`.
  /(?:^|\s)\/pass(?:word)?:["']?[^\s"']/i,
  // A literal fed to an option about a secret file: `--vault-password-file <(echo pw)`.
  /(?:pass\w{0,20}|pwd|token|secret|key|cred\w{0,10}|auth\w{0,10})(?:[-_][a-z]{1,20}){0,2}(?:\s{1,5}|=)["']?<\(\s{0,5}(?:echo|printf)\s{1,5}(?:-[a-zA-Z]{1,3}\s{1,5}){0,3}["']?[^\s"'$)-]/i,
  // 2. Short options of listed tools.
  ...SHORT_OPTIONS.map(shortOption),
  /(?:^|[^\w.-])vault\s{1,5}login\s{1,5}\S/,
  // Tools that take the secret as a plain argument. `sqlplus / as sysdba` and `sqlplus u@db` have none.
  // Oracle's Data Pump and export tools take the same `user/pw@db`, also as `userid=` (`expdp system/pw@orcl`).
  /(?:^|[^\w.-])(?:sqlplus|expdp|impdp|exp|imp)(?:\s{1,5}-\S{1,20}){0,4}\s{1,5}(?:userid=)?["']?[^\s/"'@=.-][^\s/"'@=]{0,99}\/[^\s/"'@]{1,200}/i,
  // `wpa_passphrase ssid` alone reads the passphrase from stdin.
  /(?:^|[^\w.-])wpa_passphrase\s{1,5}["']?[^\s"']{1,100}["']?\s{1,5}["']?[^\s"'<|>]/,
  // `net use Z: \\h\s pw`; `*` asks, and `/user:` is an option.
  /(?:^|[^\w.-])net\s{1,5}use\s(?:[^\n|;&]{0,200}\s)?\\\\\S{1,200}\s{1,5}["']?[^\s"'*/]/i,
  // sudo's own options come before the command it runs: `sudo -u root -S cmd`, not `sudo pacman -S git`.
  /(?:^|[^\w.-])sudo(?:\s{1,5}(?:-[A-RT-Za-z]{0,9}[ugpCDrtTUh]\s{1,5}[^\s-]\S{0,100}|-[A-RT-Za-z]{1,10}|--[a-z-]{1,20}(?:=\S{0,100})?)){0,8}\s{1,5}(?:-[A-Za-z]{0,9}S|--stdin)(?![\w-])/,
  // 3. Assignments with a value.
  new RegExp(`(?:passw(?:or)?d|passphrase|secret|token(?!s|iz)|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|credentials?|account_?key|sharedaccess(?:key|signature))(?![a-z0-9_]{0,20}_(?:${SETTING_PARTS})(?![a-z0-9]))[a-z0-9_]{0,40}["']?\\]?(?:${EQUALS}|${COLON}${PROSE})${VALUE}`, 'i'),
  new RegExp(`(?:^|[^a-z0-9_])(?:[a-z0-9]{1,20}_){0,4}(?:pw|pwd|pass|auth|pat|creds?)(?!_(?:${SETTING_PARTS})(?![a-z0-9]))(?:_(?!(?:${SETTING_PARTS})(?![a-z0-9]))[a-z0-9]{1,20}){0,2}(?:${EQUALS}|["']\\]?(?:${EQUALS}|${COLON}))${VALUE}`, 'i'),
  new RegExp(`(?:^|[^a-z0-9_])(?:[a-z0-9]{1,20}_){0,3}(?!(?:${DATA_KEYS})_key)[a-z0-9]{1,20}_key(?:${EQUALS}|["']${COLON})${VALUE}`, 'i'),
  // SQL: `IDENTIFIED BY 'pw'` (MySQL, Oracle), `PRAGMA key = 'pw'` (SQLCipher).
  /identified\s{1,5}(?:with\s{1,5}\S{1,60}\s{1,5})?by\s{1,5}(?:password\s{1,5})?["'][^"']/i,
  /pragma\s{1,5}(?:\w{1,30}\.)?(?:re)?(?:hex)?(?:re)?key\s{0,5}[=(]\s{0,5}["']?[^\s"';)]/i,
  // 4. Headers with a value. A scheme word (`Bearer`) needs a value after it.
  /(?:proxy-)?authorization["']?\s{0,5}[:=]\s{0,5}["']?(?:(?:bearer|basic|token|digest|bot|negotiate|ntlm)\s{1,5}["']?[^\s"']|(?!(?:bearer|basic|token|digest|bot|negotiate|ntlm)(?![a-z]))[^\s"'])|(?:set-)?cookie\s{0,5}:\s{0,5}["']?[^\s"']/i,
  /(?:^|[^a-z0-9-])(?:x-(?:[a-z0-9]{1,20}-){0,4}(?:auth|token|api-?key|secret|session|signature|password|pass|csrf)|x-functions-key|private-token|api-key|apikey|access-token|auth-token|(?:ocp-apim-)?subscription-key|dd-(?:api|application)-key)(?:-[a-z0-9]{1,20}){0,3}\s{0,5}:\s{0,5}["']?[^\s"']/i,
  // A password after a user or a certificate file: `--proxy-user u:pw`, `--cert c.pem:pw` (curl). A URL (`https://`) is no password.
  /--(?:proxy-user|cert)(?:\s{1,5}|=)["']?[^\s:"']{1,200}:[^\s"'/]/,
  // 5. URLs.
  /https?:\/\/[^\s/:@?#]{12,200}@/i,
  /(?:^|[^a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/[^\s/:@?#]{0,200}:[^\s/@?#]{1,200}@/i,
  /[?&;#](?:access_token|refresh_token|id_token|client_secret|private_token|api[_-]?key|apikey|token|key|secret|password|passwd|pwd|sig|signature|auth|code_verifier|x-amz-signature|x-amz-security-token|x-goog-signature)=/i,
  /hooks\.slack\.com\/services\/|discord(?:app)?\.com\/api\/webhooks\/|\.webhook\.office\.com\//i,
  // 6. Token shapes, case kept.
  /(?:^|[^A-Za-z0-9])(?:ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|glpat-|sk-|sk_live_|sk_test_|rk_live_|rk_test_|xox[abposr]-|xapp-|hvs\.|dop_v1_|pypi-Ag|shpat_|shpss_|AKIA[0-9A-Z]{8}|ASIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10}|npm_[A-Za-z0-9]{10})[A-Za-z0-9_-]{4}/,
  /\beyJ[A-Za-z0-9_-]{8,300}\.eyJ/,
  // Hugging Face and SendGrid; `hf_hub_download` is a name, so the run after `hf_` has no `_`.
  /(?:^|[^A-Za-z0-9])(?:hf_[A-Za-z0-9]{20}|SG\.[A-Za-z0-9_-]{10,40}\.[A-Za-z0-9_-]{8})/,
  // An age identity: `AGE-SECRET-KEY-1` and its Bech32 body.
  /AGE-SECRET-KEY-1[0-9A-Z]{10}/,
  // Docker Hub, Google OAuth access and refresh tokens, Mailgun and Twilio API keys.
  /(?:^|[^A-Za-z0-9])(?:dckr_pat_[A-Za-z0-9_-]{8}|ya29\.[A-Za-z0-9_-]{8}|1\/\/0[A-Za-z0-9_-]{20}|(?:key-|SK)[0-9a-f]{32}(?![0-9A-Za-z]))/,
  PEM_BEGIN,
  PPK_BEGIN,
  // 7. Values fed in other ways.
  new RegExp(`(?:^|[^\\w.-])(?:set|create|config(?:ure)?)\\s(?:[^\\n|;&]{0,200}[\\s:./"'])?(?:${SETTING_NAMES})["']?\\s{1,5}["']?[^\\s"'<>|-]`, 'i'),
  /(?:^|[^\w.-])config\s(?:[^\n|;&]{0,200}\s)?http-basic\.[\w.-]{1,40}\s{1,5}\S{1,100}\s{1,5}[^\s-]/,
  // A here-string into a login, a secret store or a passphrase prompt: `kinit <<< pw`, `borg init <<< pw`, `cosign sign <<< pw`, `ftp <<< "user u pw"`, `wrangler secret put X <<< v`.
  /(?:^|[^\w.-])(?:login|kinit|passwd|chpasswd|signin|unlock|borg|cosign|restic|ftp|vncpasswd|pass\s{1,5}insert|secret\s{1,5}put|env\s{1,5}add)(?![\w-])[^\n|;&]{0,200}<<<\s{0,5}["']?[^\s"']/,
  /(?:^|[^\w.-])(?:echo|printf)\s(?:[^\n|;&]{0,200}\s)?["']?[^\s:"'/$]{1,100}:[^\s"'/@]{1,100}["']?\s{0,5}\|\s{0,5}base64(?!\s{1,5}(?:-d|-D|--decode))/,
  /(?:^|[^\w.-])machine\s{1,5}\S{1,200}\s(?:[^\n]{0,200}\s)?password\s{1,5}[^\s"']/,
  // A literal echoed into a password reader or a secret store; `echo $PW |` names a variable and holds none.
  /(?:^|[^\w.-])(?:echo|printf)\s[^\n|;&$]{0,200}\|\s{0,5}(?:[^\n|;&]{0,200}\s)?(?:passwd\s(?:[^\n|;&]{0,100}\s)?--stdin|chpasswd|--password-stdin|smbpasswd\s(?:[^\n|;&]{0,100}\s)?-[a-zA-Z]{0,5}s|secret\s{1,5}(?:create|put)|env\s{1,5}add|pass\s{1,5}insert|vncpasswd)(?![\w-])/,
  // A .pgpass line: host:port:database:user:password, the port a number or `*`, the password the end
  // of the token (a MAC address or a full IPv6 address goes on), the host no bare number (`12:30:45:67:89`).
  /(?:^|[\s"'])(?!\d{1,100}:)[^\s:"'/]{1,100}:(?:\d{1,5}|\*):[^\s:"']{1,100}:[^\s:"']{1,100}:[^\s:"']{1,200}(?=[\s"']|$)/,
]

/** A line that goes on in the next one: a backslash at its end (a carriage return after it allowed). */
const CONTINUED = /\\\r?$/

/** The text with each backslash and line break that continues a command made a space. */
const joinContinued = (text: string): string => text.replace(/\\\r?\n/g, ' ')

/** True when `text` (a command, URL, pattern or path) looks like it holds a secret, a continued command read as one line. */
export function hasSecret(text: string): boolean {
  const joined = joinContinued(text)

  return SECRET_PATTERNS.some(re => re.test(joined))
}

/** What a hidden detail shows as. */
export const HIDDEN = '(hidden)'

/** `text`, or "(hidden)" when it looks like it holds a secret. The one check for every shown command or detail. */
export function hideSecrets(text: string): string {
  return hasSecret(text) ? HIDDEN : text
}

/**
 * The ticket IDs a hidden line keeps: a `#` and an ID of the mod's form, as a word of its
 * own: `#T`, a digit, then digits and capitals (``, ``, the old `#T12`), and only an ID
 * the mod's own parser gives a value (`ticketValue`: at most 6 characters after the `T`, under the
 * end of the number line). Any other `#word` may be the secret (`--password #Hunter2`,
 * `PW=(#hunter2)`), so it goes; so does a `#` glued to the text before it (`-p#Hunter2`). An ID that
 * is the line's only secret goes too (`token:`, keptIds). The one residual: a secret of the
 * mod's ID form on a line that holds another secret is kept, as it cannot be told from a reference
 * there (`token: PW=x`). Exported for the tests.
 */
export const KEPT_ID = /(?<![^\s(\[,])#[Tt]\d[0-9A-Z]*(?![0-9A-Za-z])/g

/**
 * KEPT_ID for text normalize changed, where the ID is in lower case: `#t0037`, `#t1`. The same
 * `ticketValue` bound holds on both paths, so `#t0037abc` (7 characters) goes as `abc` does.
 */
export const KEPT_NORMALIZED_ID = /(?<![^\s(\[,])#t\d[0-9a-z]*(?![0-9A-Za-z])/g

/** The most IDs a hidden line keeps: more than a line names in practice, few enough that their check stays cheap. */
const KEPT_IDS_MAX = 16

/**
 * The IDs of the mod's form in a hidden line, as `kept` finds them and `ticketValue` takes them. An
 * ID that is the secret's value is not kept: the line holds a secret, and with the ID taken out it holds none.
 *
 * At most KEPT_IDS_MAX distinct IDs, the first in the line, each once: every ID checked costs a pass
 * of the secret check over the whole line, so the cost is held to (KEPT_IDS_MAX + 1) passes, not one
 * per ID (a line of 12,000 IDs took 48 s). Exported for the tests.
 */
export const keptIds = (line: string, kept: RegExp, isSecret: (line: string) => boolean): string[] => {
  const ids = [...new Set(line.match(kept) ?? [])].filter(id => ticketValue(id.slice(1)) !== undefined).slice(0, KEPT_IDS_MAX)
  if (ids.length === 0) {
    return ids
  }
  const isLineSecret = isSecret(line)

  return ids.filter(id => !isLineSecret || isSecret(line.replace(id, '')))
}

/**
 * `text` with each line that looks like it holds a secret replaced by "(hidden)", followed by the
 * ticket IDs the line had, so a hidden line still names its tickets. For long text that is kept,
 * such as an agent's brief, and for one-line text drawn as is, such as an agent's description: the
 * other lines stay as they are.
 */
export function hideSecretLines(text: string): string {
  return hideLines(text, hasSecret, KEPT_ID)
}

/**
 * For each line of `lines`, whether the command it is part of has a secret: a line that ends in a
 * backslash goes on in the next, and each line of such a command is hidden when the command, read
 * as one line, has a secret.
 */
function secretLines(lines: readonly string[], isSecret: (line: string) => boolean): boolean[] {
  const out: boolean[] = []
  let start = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (i === lines.length - 1 || !CONTINUED.test(lines[i]!)) {
      const command = lines.slice(start, i + 1).map(line => line.replace(CONTINUED, '')).join(' ')
      const isHidden = isSecret(command)
      for (let j = start; j <= i; j += 1) {
        out.push(isHidden)
      }
      start = i + 1
    }
  }

  return out
}

/**
 * Each line `isSecret` finds (a continued command as a whole), and each line of a private key
 * block from its first line to its last (the key body has no mark of its own), as
 * "(hidden)" and the IDs `kept` finds.
 */
function hideLines(text: string, isSecret: (line: string) => boolean, kept: RegExp): string {
  const lines = text.split('\n')
  const isSecretAt = secretLines(lines, isSecret)
  // Local state: the last line of the key block the line is in, which only the lines before it can tell.
  let blockEnd: RegExp | undefined

  return lines
    .map((line, i) => {
      const isHidden = blockEnd !== undefined || isSecretAt[i]!
      if (blockEnd === undefined) {
        const block = KEY_BLOCKS.find(one => one.begin.test(line))
        blockEnd = block !== undefined && !block.end.test(line) ? block.end : undefined
      } else if (blockEnd.test(line)) {
        blockEnd = undefined
      }

      return isHidden ? [HIDDEN, ...keptIds(line, kept, isSecret)].join(' ') : line
    })
    .join('\n')
}

/**
 * Short secret words as the end of a longer word, for text `normalize` already changed (lower case,
 * `_` and brackets taken out): `dbpass=x`, `mysqlpwd=x`, `sshkey=x`; not `bypass=`. It errs wide: a
 * data key such as `sortkey=` is hidden too, since normalize took out the `_` that tells them apart. Only an old stored brief needs it
 *: a brief is hidden before normalize now, where the `_` parts are still there.
 */
const NORMALIZED_SHORT = new RegExp(`(?:^|[^a-z0-9])[a-z0-9]{1,20}(?<!by|com|sur)(?:pw|pwd|pass|auth|pat|creds?|key)${EQUALS}${VALUE}`)

/** `hideSecretLines` for text normalize already changed: each line with a secret in either form is hidden. */
export function hideNormalizedSecretLines(text: string): string {
  return hideLines(text, line => hasSecret(line) || NORMALIZED_SHORT.test(line), KEPT_NORMALIZED_ID)
}

/** A title (a headline Claude gave its work) with its secrets hidden, its ticket IDs kept; none stays none. */
export function hideTitle(title: string | undefined): string | undefined {
  return title === undefined ? undefined : hideSecretLines(title)
}
