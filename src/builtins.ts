import { AnyInfo, ArgInfo, BDType, ObjInfo, PropInfos } from "./enums";

export const STRING_PROPS:PropInfos = new Map<string,AnyInfo>();
export const LIST_PROPS:PropInfos = new Map<string,AnyInfo>();
export const DICT_PROPS:PropInfos = new Map<string,AnyInfo>();
export const BUILTINS:PropInfos = new Map<string,AnyInfo>();

function makeProp(props:Map<string,AnyInfo>, name:string, description:string, args:ArgInfo[], ret:AnyInfo){
  props.set(name, {t:BDType.FuncRef, name:name, description:description, args:args, ret:ret});
}

function makeRet(props:[string,AnyInfo][]) : ObjInfo {
  return {t:BDType.Object, props:new Map<string,AnyInfo>(props) };
}

const target_arg:ArgInfo = {name:"target", wants:BDType.String, description:"[user@]host"}
const port_arg:ArgInfo = {name:"port", wants:BDType.Number, description:"you probably want 22"}
const conn_arg:ArgInfo = {name:"conn", wants:BDType.Object, description:"created by connect"}
const user_arg:ArgInfo = {name:"user",wants:BDType.String, description:"I FIGHT FOR THE USERS!"}
const pwrd_arg:ArgInfo = {name:"password",wants:BDType.String, description:"You didn't say the magic word"}
const path_arg:ArgInfo = {name:"path",wants:BDType.String, description:"A filepath"}
const data_arg:ArgInfo = {name:"content",wants:BDType.String}
const val_arg:ArgInfo = {name:"val",wants:BDType.Unknown}
const url_arg:ArgInfo = {name:"url", wants:BDType.String}

const RET_CONNECT:ObjInfo = makeRet([
  ["id",BDType.Number],["success",BDType.Bool],["banner",BDType.String],
  ["hostname",BDType.String],["os",BDType.String],["port",BDType.Number],
  ["target",BDType.String],["trace_time",BDType.Number],["user",BDType.String],
  ["ssh_denied",BDType.Bool],
]);

const RET_SCAN:ObjInfo = makeRet([
  ["open",BDType.Bool],["service",BDType.String],["version",BDType.String], 
  ["banner",BDType.String],["response_time",BDType.Number],["filtered",BDType.Bool],
]);

const RET_PROBEVULN:ObjInfo = makeRet([
  ["found",BDType.Bool],["success",BDType.Bool],["exploited",BDType.Bool],
  ["progress",BDType.Number],["vuln_type",BDType.String],["description",BDType.String],
  ["severity",BDType.String],["security_reduction",BDType.Number],["new_security",BDType.Number],
  ["tip",BDType.String],
]);

const RET_CRACK:ObjInfo = makeRet([
  ["success",BDType.Bool],["progress",BDType.Number],["hint",BDType.String],
  ["password",BDType.String],["attempts",BDType.Number],["difficulty",BDType.String],
]);

const RET_BRUTEWEB:ObjInfo = makeRet([
  ["success",BDType.Bool],["progress",BDType.Number],["hint",BDType.String],
  ["password",BDType.String],
]);
const RET_READFILE:ObjInfo = makeRet([
  ["success",BDType.Bool],["content",BDType.String],["size",BDType.Number],
  ["owner",BDType.String],["encrypted",BDType.Bool],["encryption_type",BDType.Bool],
  ["race_locked",BDType.Bool],["last_modified",BDType.String],["error",BDType.String],
]);
const RET_DOWNLOAD:ObjInfo = makeRet([
  ["success",BDType.Bool],["path",BDType.String],["size",BDType.Number],
  ["local_path",BDType.String],["owner",BDType.String],["error",BDType.String],
  ["race_locked",BDType.Bool],
]);
const RET_WGET:ObjInfo = makeRet([
  ["success",BDType.Bool],["path",BDType.String],["size",BDType.Number],
  ["local_path",BDType.String],["error",BDType.String],
]);
const RET_PROBELAYER:ObjInfo = makeRet([
  ["active",BDType.Bool],["layers",BDType.Number],["layers_remaining",BDType.Number]
]);
const RET_CHIPLAYER:ObjInfo = makeRet([
  ["success",BDType.Bool],["layers_remaining",BDType.Number],["progress",BDType.Number],
  ["layer_breached",BDType.Bool],["firewall_down",BDType.Bool]
]);
const RET_DECRYPT:ObjInfo = makeRet([
  ["success",BDType.Bool], ["progress",BDType.Number], ["content",BDType.String], 
  ["already_decrypted",BDType.Bool], ["attempts",BDType.Number], ["method_hint",BDType.String]
]);
const RET_BROWSE:ObjInfo = makeRet([
  ["success",BDType.Bool],["html",BDType.String]
]);

// String Methods
makeProp(STRING_PROPS, "upper", "convert to uppercase", [], BDType.String);
makeProp(STRING_PROPS, "lower", "convert to lowercase", [], BDType.String);
makeProp(STRING_PROPS, "contains", "true if sub appears anywhere in s", [{name:"sub", wants:BDType.String}], BDType.Bool);
makeProp(STRING_PROPS, "find", "index of sub in s, or -1 if not found", [{name:"sub", wants:BDType.String}], BDType.Number);
makeProp(STRING_PROPS, "substr", "extract a portion of the string", [{name:"start", wants:BDType.Number}, {name:"length", wants:BDType.Number, opt:true}], BDType.String);
makeProp(STRING_PROPS, "trim", "strip leading and trailing whitespace", [], BDType.String);
makeProp(STRING_PROPS, "starts_with", "check the start of a string", [{name:"sub", wants:BDType.String}], BDType.Bool);
makeProp(STRING_PROPS, "ends_with", "check the end of a string", [{name:"sub", wants:BDType.String}], BDType.Bool);
makeProp(STRING_PROPS, "replace", "swap every occurrence of old with new", [{name:"old",wants:BDType.String},{name:"new",wants:BDType.String}], BDType.String);
makeProp(STRING_PROPS, "split", "cut a string into a list at each separator", [{name:"sep",wants:BDType.String}], {t:BDType.List, elem:BDType.String});
// List Methods
makeProp(LIST_PROPS, "append", "Add val to the end of the list", [val_arg], BDType.Null);
makeProp(LIST_PROPS, "insert", "Insert val at index i, shifting the rest right", [{name:"i", wants:BDType.Number},val_arg], BDType.Null);
makeProp(LIST_PROPS, "pop", "Remove and return the last item, or item at index i", [{name:"i", wants:BDType.Number, opt:true}], BDType.Unknown);
makeProp(LIST_PROPS, "remove", "remove the item at index i", [{name:"i", wants:BDType.Number}], BDType.Null);
makeProp(LIST_PROPS, "contains", "true if val is anywhere in the list", [val_arg], BDType.Bool);
// Object Methods
makeProp(DICT_PROPS, "keys", "return a list of the keys in the object", [], {t:BDType.List, elem:BDType.String});
makeProp(DICT_PROPS, "has", "return true if val is a key in the object", [val_arg], BDType.Bool);
makeProp(DICT_PROPS, "values", "return a list of the values for each key in the object", [], {t:BDType.List, elem:BDType.Unknown});

// Builtins
makeProp(BUILTINS, "log", "Print to terminal", [{name:"message", wants:BDType.Unknown}], BDType.Null);
makeProp(BUILTINS, "range", "numeric range", [{name:"start",wants:BDType.Number,description:"If this is the only arg, this is stop (starts at 0)"}, {name:"stop", wants:BDType.Number, opt:true}, {name:"step",wants:BDType.Number, opt:true}], BDType.Null);
makeProp(BUILTINS, "len", "list or string length", [{name:"list",wants:[BDType.List, BDType.String]}], BDType.Number);
makeProp(BUILTINS, "str", "cast to string", [val_arg], BDType.String);
makeProp(BUILTINS, "int", "cast to number", [val_arg], BDType.Number);
makeProp(BUILTINS, "type", "get variable type", [val_arg], BDType.String);
makeProp(BUILTINS, "get_param", "Read param value", [{name:"name", wants:BDType.String}, {name:"fallback", wants:BDType.String, opt:true}], BDType.String);
makeProp(BUILTINS, "parse_target", "Parse target string into object", [target_arg], makeRet([["user",BDType.String],["host",BDType.String]]));
// Network
makeProp(BUILTINS, "scan", "Check if a port is open", [], RET_SCAN);
makeProp(BUILTINS, "connect", "Open a connection", [target_arg, port_arg, {...pwrd_arg, ...{opt:true}}], RET_CONNECT);
makeProp(BUILTINS, "disconnect", "Close connection", [conn_arg], BDType.Null);
makeProp(BUILTINS, "get_target", "Mission Target {ip, hostname}", [], makeRet([["ip",BDType.String],["hostname",BDType.String]]));
makeProp(BUILTINS, "resolve_hostname", "Resolve a hostname to an IP via /etc/hosts", [{name:"hostname", wants:BDType.String}], BDType.String)
makeProp(BUILTINS, "traces", "Lists active and recovering traces", [], {t:BDType.List, elem:makeRet([["ip", BDType.String], ["hostname", BDType.String], ["status", BDType.String], ["remaining", BDType.Number], ["total", BDType.Number]])});
// Security
makeProp(BUILTINS, "get_security", "Server security level (0.0-1.0)", [conn_arg], BDType.Number);
makeProp(BUILTINS, "probe_vuln", "Check next vulnerability (no side effects)", [conn_arg], RET_PROBEVULN);
makeProp(BUILTINS, "exploit_vuln", "Chip at it (progressive), lower security", [conn_arg], RET_PROBEVULN);
makeProp(BUILTINS, "probe_firewall", "Check firewall status", [target_arg], RET_PROBELAYER);
makeProp(BUILTINS, "bypass_firewall", "Chip through firewall (progressive)", [target_arg], RET_CHIPLAYER);
// Auth
makeProp(BUILTINS, "crack", "Crack a password (progressive)",[conn_arg, user_arg], RET_CRACK);
makeProp(BUILTINS, "brute_web", "Crack a web login (progressive)",[conn_arg, user_arg], RET_BRUTEWEB);
makeProp(BUILTINS, "local_crack", "Crack from inside (quieter)",[user_arg], RET_BRUTEWEB);
makeProp(BUILTINS, "su", "Switch user",[user_arg, pwrd_arg], BDType.Bool);
makeProp(BUILTINS, "get_users", "List user accounts",[conn_arg], {t:BDType.List, elem:makeRet([["name",BDType.String],["home",BDType.String],["shell",BDType.String]])});
// Files
makeProp(BUILTINS, "list_files", "List directory contents", [conn_arg, path_arg], {t:BDType.List, elem:makeRet([["name",BDType.String],["path",BDType.String],["type",BDType.String],["size",BDType.Number],["owner",BDType.String]])});
makeProp(BUILTINS, "read_file", "Read a file", [conn_arg, path_arg], RET_READFILE);
makeProp(BUILTINS, "write_file", "Write to a remote file", [conn_arg, path_arg, data_arg], BDType.Bool);
makeProp(BUILTINS, "download", "Download to ~/downloads/", [conn_arg, path_arg], RET_DOWNLOAD);
makeProp(BUILTINS, "delete_file", "Delete a file", [conn_arg, path_arg], BDType.Bool);
makeProp(BUILTINS, "file_size", "Get file size", [conn_arg, path_arg], BDType.Number);
makeProp(BUILTINS, "upload", "Upload a file to target", [conn_arg, path_arg, path_arg], BDType.Bool);
makeProp(BUILTINS, "wget", "unknown", [url_arg, user_arg, pwrd_arg], RET_WGET);
// System
makeProp(BUILTINS, "get_trace_time", "Seconds remaining before trace completes.", [], BDType.Number);
makeProp(BUILTINS, "get_noise", "Current noise level (0-100)", [], BDType.Number);
makeProp(BUILTINS, "get_cpu", "Current aggregate CPU load across all your running processes (0-100)", [], BDType.Number);
makeProp(BUILTINS, "get_my_ip", "Your current exit IP (changes with proxy bouncing)", [], BDType.String);
makeProp(BUILTINS, "whoami", "", [conn_arg], BDType.String);
makeProp(BUILTINS, "get_hostname", "Returns your current username on the connected server", [], BDType.String);
makeProp(BUILTINS, "sleep", "Wait. Reduces noise slightly", [{name:"seconds", wants:BDType.Number}], BDType.Null);
BUILTINS.set("get_time", BUILTINS.get("get_trace_time")!);
BUILTINS.set("get_detection", BUILTINS.get("get_noise")!);
// Local Files
makeProp(BUILTINS, "my_files", "List files on your local machine", [], {t:BDType.List, elem:makeRet([["name",BDType.String],["path",BDType.String],["type",BDType.String],["size",BDType.Number]])});
makeProp(BUILTINS, "read_local", "Read a local file", [path_arg], BDType.String);
makeProp(BUILTINS, "save", "Save data to a local file", [path_arg, data_arg], BDType.Null);
makeProp(BUILTINS, "local_mkdir", "Create a directory on your local machine", [path_arg], BDType.Bool);
makeProp(BUILTINS, "local_cp", "Copy a local file", [{name:"src", wants:BDType.String, description:"File to copy"}, {name:"dst", wants:BDType.String, description:"New location"}], BDType.Bool);
makeProp(BUILTINS, "local_mv", "Move/rename a local file", [{name:"src", wants:BDType.String, description:"File to move"}, {name:"dst", wants:BDType.String, description:"New location"}], BDType.Bool);
makeProp(BUILTINS, "local_rm", "Delete a local file", [path_arg], BDType.Bool);
BUILTINS.set("write_local", BUILTINS.get("read_local")!);

// Shop - QuietGrab
makeProp(BUILTINS, "file_type", "Check file type before download", [conn_arg, path_arg], BDType.String);
// Shop - ProxyChain
makeProp(BUILTINS, "pivot", "Route through proxy (+15s trace, capped at 5 hops)", [conn_arg], BDType.Bool);
makeProp(BUILTINS, "pivot_clear", "Clear the entire proxy chain", [conn_arg], BDType.Null);
// Shop - LogScrubber
makeProp(BUILTINS, "scrub_log", "Remove your IP from log files", [conn_arg, path_arg, target_arg], makeRet([["removed",BDType.Number],["remaining",BDType.Number]]));
// Shop - CryptoKit
makeProp(BUILTINS, "decrypt", "Decrypt a file (progressive)", [conn_arg, path_arg], RET_DECRYPT);
makeProp(BUILTINS, "detect_encryption", "Check encryption type", [conn_arg, path_arg], makeRet([["encrypted",BDType.Bool], ["type",BDType.String], ["error",BDType.String]]));
// Shop - HoneyCheck
makeProp(BUILTINS, "is_honeypot", "Detect honeypot servers", [target_arg, port_arg], BDType.Bool);
// Shop - PatternKit
makeProp(BUILTINS, "extract_ips", "Extract IPv4 addresses", [data_arg], {t:BDType.List, elem:BDType.String});
makeProp(BUILTINS, "extract_emails", "Extract email addresses", [data_arg], {t:BDType.List, elem:BDType.String});
makeProp(BUILTINS, "extract_urls", "Extract http/https URLs", [data_arg], {t:BDType.List, elem:BDType.String});
makeProp(BUILTINS, "extract_credentials", "Extract password/key/token", [data_arg], {t:BDType.List, elem:BDType.String});
// Shop - FireBreak
makeProp(BUILTINS, "fast_bypass", "Enhanced firewall bypass", [target_arg], RET_CHIPLAYER);
// Shop - Crack Source
makeProp(BUILTINS, "grab_hash", "Retrieve the hash for a user's password", [conn_arg, user_arg], makeRet([["hash",BDType.String],["salt",BDType.String],["security",BDType.Number]]));
makeProp(BUILTINS, "hash_distance", "Compare hash strings, zero means identical", [{name:"H1", wants:BDType.String},{name:"H2", wants:BDType.String}], BDType.Number);
makeProp(BUILTINS, "hash_string", "Hash a string", [data_arg, {name:"salt", wants:BDType.String}, {name:"security", wants:BDType.Number, opt:true}], BDType.String);
makeProp(BUILTINS, "random_char", "Set character at pos to a random character", [{name:"pos", wants:BDType.Number}, {name:"char", wants:BDType.String}], BDType.String);
makeProp(BUILTINS, "to_char", "Convert ASCII value to character", [{name:"code", wants:BDType.Number}], BDType.String); // always unlocked now?
makeProp(BUILTINS, "set_char", "Set character at pos to a given character", [data_arg, {name:"pos", wants:BDType.Number}, {name:"char", wants:BDType.String}], BDType.String); // always unlocked now?
// Shop - Bypass Source
makeProp(BUILTINS, "probe_layer", "Low-level firewall probe", [target_arg], RET_PROBELAYER);
makeProp(BUILTINS, "chip_layer", "One tick of firewall bypass with no automatic output", [target_arg], RET_CHIPLAYER);
// Web Attack Vectors
makeProp(BUILTINS, "sqli", "Test a web form for SQL injection", [conn_arg, url_arg], makeRet([["success",BDType.Bool],["data",BDType.String],["error",BDType.String]]));
makeProp(BUILTINS, "cmd_inject", "Test a web form for command injection", [conn_arg, url_arg], makeRet([["success",BDType.Bool],["output",BDType.String],["error",BDType.String]]));
makeProp(BUILTINS, "browse", "unknown", [url_arg], RET_BROWSE);
makeProp(BUILTINS, "click", "unknown", [{name:"text", wants:BDType.String}], RET_BROWSE);
makeProp(BUILTINS, "fill_form", "unknown", [{name:"field", wants:BDType.String}, {name:"value", wants:BDType.String}], BDType.Bool);
makeProp(BUILTINS, "submit_form", "unknown", [], RET_BROWSE);
makeProp(BUILTINS, "find_links", "unknown", [{name:"html", wants:BDType.String}], {t:BDType.List, elem:makeRet([["text", BDType.String], ["href", BDType.String]])});
makeProp(BUILTINS, "find_forms", "unknown", [{name:"html", wants:BDType.String}], {t:BDType.List, elem:makeRet([["action", BDType.String], ["fields", makeRet([["name", BDType.String], ["type", BDType.String]])]])});
// mail/SMTP
makeProp(BUILTINS, "smtp_connect", "Open a connection to a mail server (port 25) - No auth required", [target_arg], makeRet([["id",BDType.Number],["success",BDType.Bool],["banner",BDType.String]]));
makeProp(BUILTINS, "smtp_login", "Authenticate to a mailbox", [conn_arg, user_arg, pwrd_arg], BDType.Bool);
makeProp(BUILTINS, "smtp_read", "Read a mailbox. Requires smtp_login() for that user first.", [conn_arg, user_arg], {t:BDType.List, elem:makeRet([["from",BDType.String],["subject",BDType.String],["body",BDType.String]])});
makeProp(BUILTINS, "smtp_send", "Send an email", [conn_arg, {name:"from", wants:BDType.String}, {name:"to", wants:BDType.String}, {name:"subject", wants:BDType.String}, {name:"body", wants:BDType.String}], BDType.Bool);

/* 
Template: 
makeProp(BUILTINS, "unknown", "unknown", [], unknown);

MISSING:
  ...
*/