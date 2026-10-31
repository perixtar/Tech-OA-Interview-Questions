// Turns a FastPrep function signature + example cases into runnable programs.
//
// Every generated program prints the same line protocol, whatever the language:
//   @@OA@@ BEGIN <case>
//   @@OA@@ END <case> <ms> <json result>
//   @@OA@@ ERR <case> 0 <json message>
//   @@OA@@ COMPILE 0 0 <json message>
// Anything else printed between BEGIN and END is that case's stdout.

export const LANGUAGES = {
  python: { label: 'Python', mode: 'ace/mode/python', ext: 'py' },
  javascript: { label: 'JavaScript', mode: 'ace/mode/javascript', ext: 'js' },
  java: { label: 'Java', mode: 'ace/mode/java', ext: 'java' },
  cpp: { label: 'C++', mode: 'ace/mode/c_cpp', ext: 'cpp' },
};

const MARK = '@@OA@@ ';
const IDENT = /^[A-Za-z_$][\w$]*$/;

/* ---------------------------------------------------------------- signature */

export function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if ('<[({'.includes(c)) depth++;
    else if ('>])}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}

const SCALARS = {
  int: 'int', integer: 'int', short: 'int', byte: 'int',
  long: 'long', 'long long': 'long',
  double: 'double', float: 'double', number: 'double',
  boolean: 'bool', bool: 'bool',
  string: 'string', str: 'string',
  char: 'char', character: 'char',
  void: 'void',
};

export function parseType(raw) {
  const t = String(raw || '').trim();
  if (t.endsWith('[]')) return { kind: 'list', array: true, of: parseType(t.slice(0, -2)) };
  const generic = t.match(/^(\w+)\s*<(.+)>$/);
  if (generic) {
    const [, outer, inner] = generic;
    const args = splitTopLevel(inner);
    if (/^(List|ArrayList|LinkedList|Collection|Iterable|Set|HashSet|TreeSet|Deque|Queue|vector)$/.test(outer) && args.length === 1) {
      return { kind: 'list', array: false, of: parseType(args[0]) };
    }
    if (/^(Map|HashMap|TreeMap|LinkedHashMap|map|unordered_map)$/.test(outer) && args.length === 2) {
      return { kind: 'map', key: parseType(args[0]), value: parseType(args[1]) };
    }
  }
  const scalar = SCALARS[t.toLowerCase()];
  return scalar ? { kind: scalar } : { kind: 'unknown', raw: t };
}

function typeKnown(ast) {
  if (ast.kind === 'unknown') return false;
  if (ast.kind === 'list') return typeKnown(ast.of);
  if (ast.kind === 'map') return typeKnown(ast.key) && typeKnown(ast.value);
  return true;
}

// Returns { name, params: [{ name, type, ast }], ret, retAst } or null when the
// problem has no callable signature (system design, project work, ...).
export function parseSignature(problem) {
  if (!problem || problem.hasSignature === false) return null;
  const raw = (problem.signature || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const m = raw.match(/^\s*([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*(?:→|->|:)\s*(.+?)\s*$/);
  if (!m) return null;
  const [, name, paramStr, ret] = m;
  const params = splitTopLevel(paramStr).map(p => {
    const i = p.indexOf(':');
    const pname = (i < 0 ? p : p.slice(0, i)).trim();
    const type = i < 0 ? 'any' : p.slice(i + 1).trim();
    return { name: pname, type, ast: parseType(type) };
  });
  if (name === 'solve' && !params.length && ret === 'any') return null;
  if (!params.every(p => IDENT.test(p.name))) return null;
  return { name, params, ret, retAst: parseType(ret) };
}

export function harnessSupport(lang, sig) {
  if (!sig) return false;
  if (lang === 'python' || lang === 'javascript') return true;
  const paramsOk = sig.params.every(p => typeKnown(p.ast) && p.ast.kind !== 'void');
  if (lang === 'java') return paramsOk;
  return paramsOk && (typeKnown(sig.retAst));
}

/* ------------------------------------------------------------------- values */

// Lenient literal parser: JSON plus Python-isms (True/None, 'single quotes', tuples).
// Integers beyond 2^53 come back as BigInt so `long` inputs survive round-trips.
export function parseValue(text) {
  const src = String(text ?? '').trim();
  let i = 0;
  const fail = msg => {
    throw new SyntaxError(msg || `Unexpected ${i < src.length ? `"${src[i]}"` : 'end of input'} at position ${i + 1}`);
  };
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };

  function str(q) {
    let out = '';
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        const n = src[++i];
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '0': '\0' };
        if (n === 'u') {
          out += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16));
          i += 5;
          continue;
        }
        out += map[n] ?? n;
        i++;
      } else {
        out += src[i++];
      }
    }
    if (src[i] !== q) fail('Unterminated string');
    i++;
    return out;
  }

  function seq(close) {
    const arr = [];
    i++;
    for (;;) {
      ws();
      if (src[i] === close) {
        i++;
        return arr;
      }
      arr.push(value());
      ws();
      if (src[i] === ',') i++;
      else if (src[i] !== close) fail();
    }
  }

  function obj() {
    const o = {};
    i++;
    for (;;) {
      ws();
      if (src[i] === '}') {
        i++;
        return o;
      }
      let key;
      if (src[i] === '"' || src[i] === "'") key = str(src[i]);
      else {
        const m = /^[\w.-]+/.exec(src.slice(i));
        if (!m) fail();
        key = m[0];
        i += key.length;
      }
      ws();
      if (src[i] !== ':') fail();
      i++;
      o[key] = value();
      ws();
      if (src[i] === ',') i++;
      else if (src[i] !== '}') fail();
    }
  }

  function value() {
    ws();
    const c = src[i];
    if (c === '[') return seq(']');
    if (c === '(') return seq(')');
    if (c === '{') return obj();
    if (c === '"' || c === "'") return str(c);
    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      const lit = num[0];
      if (/^[+-]?\d+$/.test(lit)) {
        const n = Number(lit);
        return Number.isSafeInteger(n) ? n : BigInt(lit);
      }
      return Number(lit);
    }
    const word = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (word) {
      i += word[0].length;
      const w = word[0];
      if (w === 'true' || w === 'True') return true;
      if (w === 'false' || w === 'False') return false;
      if (w === 'null' || w === 'None' || w === 'nil' || w === 'nullptr') return null;
      if (w === 'Infinity' || w === 'inf') return Infinity;
      if (w === 'NaN' || w === 'nan') return NaN;
      fail(`Unknown word "${w}"`);
    }
    fail();
  }

  if (!src) fail('Empty value');
  const v = value();
  ws();
  if (i < src.length) fail();
  return v;
}

export function tryParseValue(text) {
  try {
    return { ok: true, value: parseValue(text) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// JSON with BigInt support (Python's json module reads big ints exactly).
export function toJson(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map(toJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${toJson(x)}`).join(',')}}`;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
  return JSON.stringify(v ?? null);
}

export function formatValue(v) {
  if (v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map(formatValue).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${formatValue(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function valuesEqual(a, b) {
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    return (typeof a === 'bigint' || typeof a === 'number') && (typeof b === 'bigint' || typeof b === 'number')
      ? a == b // eslint-disable-line eqeqeq
      : false;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, k) => valuesEqual(x, b[k]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every(k => k in b && valuesEqual(a[k], b[k]));
  }
  return a === b;
}

/* -------------------------------------------------------------------- cases */

export function parseAssignments(inputRaw) {
  const text = String(inputRaw || '');
  const marks = [...text.matchAll(/^[ \t]*([A-Za-z_]\w*)[ \t]*=(?!=)[ \t]*/gm)];
  return marks.map((m, k) => ({
    name: m[1],
    raw: text.slice(m.index + m[0].length, k + 1 < marks.length ? marks[k + 1].index : undefined).trim(),
  }));
}

// Example cases as editable text: [{ values: { param: "literal" }, expected: "literal" }]
export function casesFromProblem(problem, sig) {
  const source = (problem.examples && problem.examples.length ? problem.examples : problem.testCases || [])
    .filter(tc => tc && tc.inputRaw && !/=\s*\.\.\.\s*$/m.test(tc.inputRaw));
  const params = sig ? sig.params.map(p => p.name) : [];
  return source.map(tc => {
    const assigns = parseAssignments(tc.inputRaw);
    const byName = Object.fromEntries(assigns.map(a => [a.name, a.raw]));
    const values = {};
    params.forEach((name, k) => {
      values[name] = byName[name] ?? assigns[k]?.raw ?? '';
    });
    return { values, expected: (tc.expectedRaw || '').trim() };
  });
}

export function caseArgs(testCase, sig) {
  return sig.params.map(p => {
    const r = tryParseValue(testCase.values[p.name]);
    if (!r.ok) throw new Error(`Can't read ${p.name}: ${r.error}`);
    return r.value;
  });
}

/* ------------------------------------------------------------ starter code */

const CPP_KEYWORDS = new Set('and asm auto bool break case catch char class const continue default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new not operator or private protected public register return short signed sizeof static struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile while'.split(' '));
const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while'.split(' '));
const safeName = (name, keywords) => (keywords.has(name) ? `${name}_` : name);

function pyType(t) {
  switch (t.kind) {
    case 'int': case 'long': return 'int';
    case 'double': return 'float';
    case 'bool': return 'bool';
    case 'string': case 'char': return 'str';
    case 'void': return 'None';
    case 'list': return `List[${pyType(t.of)}]`;
    case 'map': return `Dict[${pyType(t.key)}, ${pyType(t.value)}]`;
    default: return 'Any';
  }
}

function jsType(t) {
  switch (t.kind) {
    case 'int': case 'long': case 'double': return 'number';
    case 'bool': return 'boolean';
    case 'string': case 'char': return 'string';
    case 'void': return 'void';
    case 'list': return `${jsType(t.of)}[]`;
    case 'map': return `Object<${jsType(t.key)}, ${jsType(t.value)}>`;
    default: return '*';
  }
}

function javaType(t, boxed = false) {
  switch (t.kind) {
    case 'int': return boxed ? 'Integer' : 'int';
    case 'long': return boxed ? 'Long' : 'long';
    case 'double': return boxed ? 'Double' : 'double';
    case 'bool': return boxed ? 'Boolean' : 'boolean';
    case 'char': return boxed ? 'Character' : 'char';
    case 'string': return 'String';
    case 'void': return 'void';
    case 'list': return t.array ? `${javaType(t.of)}[]` : `List<${javaType(t.of, true)}>`;
    case 'map': return `Map<${javaType(t.key, true)}, ${javaType(t.value, true)}>`;
    default: return t.raw || 'Object';
  }
}

function cppType(t) {
  switch (t.kind) {
    case 'int': return 'int';
    case 'long': return 'long long';
    case 'double': return 'double';
    case 'bool': return 'bool';
    case 'char': return 'char';
    case 'string': return 'string';
    case 'void': return 'void';
    case 'list': return `vector<${cppType(t.of)}>`;
    case 'map': return `map<${cppType(t.key)}, ${cppType(t.value)}>`;
    default: return t.raw || 'auto';
  }
}

export function starterCode(lang, sig) {
  if (!sig) return PLAYGROUND_STARTERS[lang];
  const { name, params, retAst } = sig;
  switch (lang) {
    case 'python': {
      const args = params.map(p => `${p.name}: ${pyType(p.ast)}`);
      return `class Solution:\n    def ${name}(${['self', ...args].join(', ')}) -> ${pyType(retAst)}:\n        pass\n`;
    }
    case 'javascript': {
      const docs = params.map(p => ` * @param {${jsType(p.ast)}} ${p.name}`);
      return `/**\n${[...docs, ` * @return {${jsType(retAst)}}`].join('\n')}\n */\nfunction ${name}(${params.map(p => p.name).join(', ')}) {\n    \n}\n`;
    }
    case 'java': {
      const args = params.map(p => `${javaType(p.ast)} ${safeName(p.name, JAVA_KEYWORDS)}`).join(', ');
      return `class Solution {\n    public ${javaType(retAst)} ${name}(${args}) {\n        \n    }\n}\n`;
    }
    case 'cpp': {
      const args = params.map(p => {
        const ref = p.ast.kind === 'list' || p.ast.kind === 'map' ? '&' : '';
        return `${cppType(p.ast)}${ref} ${safeName(p.name, CPP_KEYWORDS)}`;
      }).join(', ');
      return `class Solution {\npublic:\n    ${cppType(retAst)} ${name}(${args}) {\n        \n    }\n};\n`;
    }
  }
  return '';
}

const PLAYGROUND_STARTERS = {
  python: `# No function signature for this problem — this runs as a plain script.\n\ndef main():\n    print("hello")\n\n\nmain()\n`,
  javascript: `// No function signature for this problem — this runs as a plain script.\n\nconsole.log("hello");\n`,
  java: `import java.util.*;\n\nclass Main {\n    public static void main(String[] args) {\n        System.out.println("hello");\n    }\n}\n`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    cout << "hello" << endl;\n    return 0;\n}\n`,
};

/* ----------------------------------------------------------------- literals */

class LiteralError extends Error {}

function requireKind(ok, v, what) {
  if (!ok) throw new LiteralError(`expected ${what}, got ${formatValue(v)}`);
}

const isInt = v => (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint';
const numLit = v => {
  const s = String(v);
  return /[.eE]/.test(s) || !/^-?\d+$/.test(s) ? s : `${s}.0`;
};

function cppString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function javaString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

const charLit = (s, quote) => {
  const c = s === "'" ? "\\'" : s === '\\' ? '\\\\' : s === '\n' ? '\\n' : s === '\t' ? '\\t' : s;
  return quote ? `'${c}'` : c;
};

function mapKey(k, keyAst) {
  return keyAst.kind === 'int' || keyAst.kind === 'long' || keyAst.kind === 'double' ? Number(k) : k;
}

function cppLiteral(v, t) {
  switch (t.kind) {
    case 'int':
      requireKind(isInt(v), v, 'an integer');
      return String(v);
    case 'long':
      requireKind(isInt(v), v, 'an integer');
      return `${v}LL`;
    case 'double':
      requireKind(typeof v === 'number' || typeof v === 'bigint', v, 'a number');
      return numLit(v);
    case 'bool':
      requireKind(typeof v === 'boolean', v, 'true/false');
      return String(v);
    case 'string':
      requireKind(typeof v === 'string', v, 'a string');
      return cppString(v);
    case 'char':
      requireKind(typeof v === 'string' && [...v].length === 1, v, 'a single character');
      return charLit(v, true);
    case 'list':
      requireKind(Array.isArray(v), v, 'a list');
      return `${cppType(t)}{${v.map(x => cppLiteral(x, t.of)).join(', ')}}`;
    case 'map':
      requireKind(v && typeof v === 'object' && !Array.isArray(v), v, 'an object');
      return `${cppType(t)}{${Object.entries(v).map(([k, x]) => `{${cppLiteral(mapKey(k, t.key), t.key)}, ${cppLiteral(x, t.value)}}`).join(', ')}}`;
  }
  throw new LiteralError(`unsupported type ${t.raw || t.kind}`);
}

function javaLiteral(v, t) {
  switch (t.kind) {
    case 'int':
      requireKind(isInt(v), v, 'an integer');
      return String(v);
    case 'long':
      requireKind(isInt(v), v, 'an integer');
      return `${v}L`;
    case 'double':
      requireKind(typeof v === 'number' || typeof v === 'bigint', v, 'a number');
      return numLit(v);
    case 'bool':
      requireKind(typeof v === 'boolean', v, 'true/false');
      return String(v);
    case 'string':
      requireKind(typeof v === 'string', v, 'a string');
      return javaString(v);
    case 'char':
      requireKind(typeof v === 'string' && v.length === 1, v, 'a single character');
      return charLit(v, true);
    case 'list':
      requireKind(Array.isArray(v), v, 'a list');
      return t.array
        ? `new ${javaType(t)}{${v.map(x => javaLiteral(x, t.of)).join(', ')}}`
        : `oaList(${v.map(x => javaLiteral(x, t.of)).join(', ')})`;
    case 'map':
      requireKind(v && typeof v === 'object' && !Array.isArray(v), v, 'an object');
      return `oaMap(${Object.entries(v).map(([k, x]) => `${javaLiteral(mapKey(k, t.key), t.key)}, ${javaLiteral(x, t.value)}`).join(', ')})`;
  }
  throw new LiteralError(`unsupported type ${t.raw || t.kind}`);
}

function literalOrThrow(fn, v, p, caseIndex) {
  try {
    return fn(v, p.ast);
  } catch (err) {
    if (err instanceof LiteralError) {
      throw new Error(`Case ${caseIndex + 1}, ${p.name}: ${err.message}`);
    }
    throw err;
  }
}

/* --------------------------------------------------------------- programs */

const PY_PRELUDE = `import sys as __oa_sys, json as __oa_json, time as __oa_time, traceback as __oa_tb, linecache as __oa_lc
from typing import *
import collections, heapq, bisect, itertools, functools, math, re, string
from collections import Counter, defaultdict, deque, OrderedDict
from functools import lru_cache, cache, reduce
from heapq import heappush, heappop, heapify
from bisect import bisect_left, bisect_right
__oa_sys.setrecursionlimit(10000)
`;

function pythonProgram(code, sig, argsList) {
  return `${PY_PRELUDE}
__oa_src = ${JSON.stringify(code)}
__oa_lc.cache['solution.py'] = (len(__oa_src), None, __oa_src.splitlines(True), 'solution.py')
__oa_cases = __oa_json.loads(${JSON.stringify(toJson(argsList))})

def __oa_default(o):
    try:
        return list(o)
    except TypeError:
        return repr(o)

def __oa_dump(v):
    try:
        return __oa_json.dumps(v, default=__oa_default, separators=(',', ':'), allow_nan=False)
    except ValueError:
        return __oa_json.dumps(repr(v))

def __oa_main():
    try:
        exec(compile(__oa_src, 'solution.py', 'exec'), globals())
    except BaseException as e:
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        msg = ''.join(__oa_tb.format_exception(type(e), e, tb)).strip()
        print('\\n${MARK}COMPILE 0 0 ' + __oa_json.dumps(msg), flush=True)
        return
    fn = globals().get(${JSON.stringify(sig.name)})
    cls = globals().get('Solution')
    if callable(fn) and not isinstance(fn, type):
        get = lambda: fn
    elif isinstance(cls, type) and hasattr(cls, ${JSON.stringify(sig.name)}):
        get = lambda: getattr(cls(), ${JSON.stringify(sig.name)})
    else:
        get = None
    for i, args in enumerate(__oa_cases):
        print('\\n${MARK}BEGIN %d' % i, flush=True)
        try:
            if get is None:
                raise NameError("Function '${sig.name}' is not defined")
            f = get()
            t = __oa_time.perf_counter()
            r = f(*args)
            ms = (__oa_time.perf_counter() - t) * 1000
            print('\\n${MARK}END %d %.3f %s' % (i, ms, __oa_dump(r)), flush=True)
        except Exception as e:
            tb = e.__traceback__.tb_next if e.__traceback__ else None
            msg = ''.join(__oa_tb.format_exception(type(e), e, tb)).strip()
            print('\\n${MARK}ERR %d 0 %s' % (i, __oa_json.dumps(msg)), flush=True)

__oa_main()
`;
}

function pythonScript(code) {
  return `import sys as __oa_sys, traceback as __oa_tb, linecache as __oa_lc
__oa_src = ${JSON.stringify(code)}
__oa_lc.cache['solution.py'] = (len(__oa_src), None, __oa_src.splitlines(True), 'solution.py')
try:
    exec(compile(__oa_src, 'solution.py', 'exec'), {'__name__': '__main__'})
except SystemExit:
    pass
except BaseException as e:
    __oa_tb.print_exception(type(e), e, e.__traceback__.tb_next if e.__traceback__ else None)
`;
}

// Runs inside js.worker.js as the body of `new Function('console', source)`.
function javascriptProgram(code, sig, argsList) {
  const name = sig.name;
  return `${code}
;(() => {
  const cases = ${JSON.stringify(toJson(argsList))};
  const parsed = JSON.parse(cases);
  let get = null;
  try { if (typeof ${name} === 'function') { const f = ${name}; get = () => f; } } catch (e) {}
  if (!get && typeof Solution === 'function') {
    get = () => { const s = new Solution(); return typeof s.${name} === 'function' ? s.${name}.bind(s) : null; };
  }
  const json = v => JSON.stringify(v === undefined ? null : v, (k, x) =>
    x === undefined ? null
      : typeof x === 'bigint' ? Number(x)
      : x instanceof Map ? Object.fromEntries(x)
      : x instanceof Set ? [...x]
      : typeof x === 'number' && !Number.isFinite(x) ? String(x)
      : x);
  for (let i = 0; i < parsed.length; i++) {
    console.log('\\n${MARK}BEGIN ' + i);
    try {
      const f = get && get();
      if (typeof f !== 'function') throw new ReferenceError("Function '${name}' is not defined");
      const t = performance.now();
      const r = f(...parsed[i]);
      const ms = performance.now() - t;
      console.log('\\n${MARK}END ' + i + ' ' + ms.toFixed(3) + ' ' + json(r));
    } catch (e) {
      console.log('\\n${MARK}ERR ' + i + ' 0 ' + JSON.stringify(e && e.name ? e.name + ': ' + e.message : String(e)));
    }
  }
})();
`;
}

const CPP_JSON = String.raw`
static void oa_json(ostream& o, const string& s) {
  o << '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"': o << "\\\""; break;
      case '\\': o << "\\\\"; break;
      case '\n': o << "\\n"; break;
      case '\r': o << "\\r"; break;
      case '\t': o << "\\t"; break;
      default:
        if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o << b; }
        else o << c;
    }
  }
  o << '"';
}
static void oa_json(ostream& o, const char* s) { oa_json(o, string(s)); }
static void oa_json(ostream& o, char c) { oa_json(o, string(1, c)); }
static void oa_json(ostream& o, bool v) { o << (v ? "true" : "false"); }
static void oa_json(ostream& o, int v) { o << v; }
static void oa_json(ostream& o, long v) { o << v; }
static void oa_json(ostream& o, long long v) { o << v; }
static void oa_json(ostream& o, unsigned v) { o << v; }
static void oa_json(ostream& o, unsigned long v) { o << v; }
static void oa_json(ostream& o, unsigned long long v) { o << v; }
static void oa_json(ostream& o, double v) {
  if (std::isfinite(v)) { ostringstream s; s << setprecision(15) << v; o << s.str(); }
  else oa_json(o, string(std::isnan(v) ? "NaN" : (v > 0 ? "Infinity" : "-Infinity")));
}
static void oa_json(ostream& o, float v) { oa_json(o, (double)v); }
template <class T> void oa_json(ostream& o, const vector<T>& v);
template <class T> void oa_json(ostream& o, const set<T>& v);
template <class A, class B> void oa_json(ostream& o, const pair<A, B>& p);
template <class K, class V> void oa_json(ostream& o, const map<K, V>& m);
template <class K, class V> void oa_json(ostream& o, const unordered_map<K, V>& m);
template <class T> void oa_json(ostream& o, const vector<T>& v) {
  o << '['; bool first = true;
  for (const auto& e : v) { if (!first) o << ','; first = false; oa_json(o, (T)e); }
  o << ']';
}
template <class T> void oa_json(ostream& o, const set<T>& v) {
  o << '['; bool first = true;
  for (const auto& e : v) { if (!first) o << ','; first = false; oa_json(o, e); }
  o << ']';
}
template <class A, class B> void oa_json(ostream& o, const pair<A, B>& p) {
  o << '['; oa_json(o, p.first); o << ','; oa_json(o, p.second); o << ']';
}
template <class K, class V> void oa_json(ostream& o, const map<K, V>& m) {
  o << '{'; bool first = true;
  for (const auto& kv : m) { if (!first) o << ','; first = false; ostringstream k; k << kv.first; oa_json(o, k.str()); o << ':'; oa_json(o, kv.second); }
  o << '}';
}
template <class K, class V> void oa_json(ostream& o, const unordered_map<K, V>& m) {
  map<K, V> sorted(m.begin(), m.end()); oa_json(o, sorted);
}
`;

function cppProgram(code, sig, argsList) {
  const usesClass = /\b(class|struct)\s+Solution\b/.test(code);
  const cases = argsList.map((args, i) => {
    const decls = sig.params.map((p, k) => `  ${cppType(p.ast)} oa_a${k} = ${literalOrThrow(cppLiteral, args[k], p, i)};`);
    const call = `${usesClass ? 'oa_s.' : ''}${sig.name}(${sig.params.map((_, k) => `oa_a${k}`).join(', ')})`;
    const isVoid = sig.retAst.kind === 'void';
    return `static void oa_case_${i}() {
  cout << "\\n${MARK}BEGIN ${i}" << endl;
${decls.join('\n')}
${usesClass ? '  Solution oa_s;\n' : ''}  auto oa_t0 = chrono::steady_clock::now();
  ${isVoid ? `${call};` : `auto oa_r = ${call};`}
  double oa_ms = chrono::duration<double, milli>(chrono::steady_clock::now() - oa_t0).count();
  cout << "\\n${MARK}END ${i} " << oa_ms << " "; ${isVoid ? 'cout << "null";' : 'oa_json(cout, oa_r);'} cout << endl;
}`;
  });
  const runs = argsList.map((_, i) => `  try { oa_case_${i}(); }
  catch (const exception& e) { cout << "\\n${MARK}ERR ${i} 0 "; oa_json(cout, string(e.what())); cout << endl; }
  catch (...) { cout << "\\n${MARK}ERR ${i} 0 \\"unknown exception\\"" << endl; }`);

  return `#include <bits/stdc++.h>
using namespace std;

${code}

// ---- test harness ----
${CPP_JSON}
${cases.join('\n\n')}

int main() {
${runs.join('\n')}
  return 0;
}
`;
}

const JAVA_HELPERS = String.raw`
  @SafeVarargs static <T> List<T> oaList(T... xs) { return new ArrayList<>(Arrays.asList(xs)); }
  @SuppressWarnings("unchecked") static <K, V> Map<K, V> oaMap(Object... kv) {
    Map<K, V> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put((K) kv[i], (V) kv[i + 1]);
    return m;
  }
  static String oaJson(Object o) { StringBuilder sb = new StringBuilder(); oaWrite(sb, o); return sb.toString(); }
  static void oaWrite(StringBuilder sb, Object o) {
    if (o == null) { sb.append("null"); return; }
    if (o instanceof String) { oaStr(sb, (String) o); return; }
    if (o instanceof Character) { oaStr(sb, String.valueOf(o)); return; }
    if (o instanceof Double || o instanceof Float) {
      double d = ((Number) o).doubleValue();
      if (Double.isFinite(d)) sb.append(d); else oaStr(sb, String.valueOf(d));
      return;
    }
    if (o instanceof Number || o instanceof Boolean) { sb.append(o); return; }
    if (o.getClass().isArray()) {
      int n = java.lang.reflect.Array.getLength(o);
      sb.append('[');
      for (int i = 0; i < n; i++) { if (i > 0) sb.append(','); oaWrite(sb, java.lang.reflect.Array.get(o, i)); }
      sb.append(']');
      return;
    }
    if (o instanceof Map) {
      sb.append('{'); boolean first = true;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
        if (!first) sb.append(','); first = false;
        oaStr(sb, String.valueOf(e.getKey())); sb.append(':'); oaWrite(sb, e.getValue());
      }
      sb.append('}');
      return;
    }
    if (o instanceof Iterable) {
      sb.append('['); boolean first = true;
      for (Object x : (Iterable<?>) o) { if (!first) sb.append(','); first = false; oaWrite(sb, x); }
      sb.append(']');
      return;
    }
    oaStr(sb, String.valueOf(o));
  }
  static void oaStr(StringBuilder sb, String s) {
    sb.append('"');
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"': sb.append("\\\""); break;
        case '\\': sb.append("\\\\"); break;
        case '\n': sb.append("\\n"); break;
        case '\r': sb.append("\\r"); break;
        case '\t': sb.append("\\t"); break;
        default: if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c);
      }
    }
    sb.append('"');
  }
`;

// Wandbox compiles everything as prog.java, so top-level classes can't be public,
// and imports have to sit above the harness class.
function splitJavaImports(code) {
  const imports = [];
  const body = code
    .replace(/^\s*package\s+[\w.]+\s*;\s*$/gm, '')
    .replace(/^\s*import\s+(?:static\s+)?[\w.*]+\s*;\s*$/gm, line => {
      imports.push(line.trim());
      return '';
    })
    .replace(/^public\s+(?=(?:final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum|record)\b)/gm, '');
  return { imports, body };
}

function javaProgram(code, sig, argsList) {
  const { imports, body } = splitJavaImports(code);
  const isVoid = sig.retAst.kind === 'void';
  const cases = argsList.map((args, i) => {
    const decls = sig.params.map((p, k) => `    ${javaType(p.ast)} oa_a${k} = ${literalOrThrow(javaLiteral, args[k], p, i)};`);
    const call = `new Solution().${sig.name}(${sig.params.map((_, k) => `oa_a${k}`).join(', ')})`;
    return `  static void oaCase${i}() {
    System.out.println("\\n${MARK}BEGIN ${i}");
${decls.join('\n')}
    long oaT0 = System.nanoTime();
    ${isVoid ? `${call};\n    Object oaR = null;` : `Object oaR = ${call};`}
    double oaMs = (System.nanoTime() - oaT0) / 1e6;
    System.out.println("\\n${MARK}END ${i} " + oaMs + " " + oaJson(oaR));
  }`;
  });
  const runs = argsList.map((_, i) => `    try { oaCase${i}(); } catch (Throwable e) { System.out.println("\\n${MARK}ERR ${i} 0 " + oaJson(e.toString())); }`);

  return `import java.util.*;
import java.util.function.*;
import java.util.stream.*;
${imports.join('\n')}

class OAHarness {
${JAVA_HELPERS}
${cases.join('\n\n')}

  public static void main(String[] args) {
${runs.join('\n')}
    System.out.flush();
  }
}

${body}
`;
}

export function buildTestProgram(lang, code, sig, argsList) {
  switch (lang) {
    case 'python': return pythonProgram(code, sig, argsList);
    case 'javascript': return javascriptProgram(code, sig, argsList);
    case 'cpp': return cppProgram(code, sig, argsList);
    case 'java': return javaProgram(code, sig, argsList);
  }
  throw new Error(`Unsupported language: ${lang}`);
}

export function buildScriptProgram(lang, code) {
  if (lang === 'python') return pythonScript(code);
  if (lang === 'java') {
    const { imports, body } = splitJavaImports(code);
    return `${imports.join('\n')}\n${body}`;
  }
  return code;
}

/* ------------------------------------------------------------------ output */

export function parseHarnessOutput(text, count) {
  const cases = Array.from({ length: count }, (_, index) => ({
    index, status: 'skipped', ms: null, value: undefined, raw: '', error: null, stdout: '',
  }));
  const outside = [];
  let compileError = null;
  let current = -1;
  const buf = () => (current >= 0 ? (cases[current]._lines ||= []) : outside);

  for (const line of String(text || '').split(/\r?\n/)) {
    const at = line.indexOf(MARK);
    if (at === -1) {
      buf().push(line);
      continue;
    }
    if (at > 0) buf().push(line.slice(0, at));
    const m = line.slice(at + MARK.length).match(/^(BEGIN|END|ERR|COMPILE) (\d+)(?: (\S+))?(?: (.*))?$/);
    if (!m) continue;
    const [, kind, idxStr, ms, payload] = m;
    const idx = Number(idxStr);
    const c = cases[idx];
    if (kind === 'COMPILE') {
      compileError = safeJson(payload);
      continue;
    }
    if (!c) continue;
    if (kind === 'BEGIN') {
      c.status = 'running';
      current = idx;
    } else if (kind === 'END') {
      c.status = 'ok';
      c.ms = Number(ms);
      c.raw = payload ?? '';
      const parsed = tryParseValue(c.raw);
      c.value = parsed.ok ? parsed.value : c.raw;
      current = -1;
    } else if (kind === 'ERR') {
      c.status = 'error';
      c.error = String(safeJson(payload));
      current = -1;
    }
  }

  for (const c of cases) {
    c.stdout = (c._lines || []).join('\n').replace(/^\n+|\s+$/g, '');
    delete c._lines;
    if (c.status === 'running') c.status = 'crashed';
  }
  return { cases, stdout: outside.join('\n').trim(), compileError };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s ?? '';
  }
}
