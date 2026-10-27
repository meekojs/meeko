import assert from "node:assert/strict";
import test from "node:test";
import { scanInterpolations } from "../src/compiler/interpolation.ts";
import { decodeTemplateText } from "../src/compiler/template.ts";

function expressions(text: string): string[] {
  const scan = scanInterpolations(text);
  assert.equal(scan.unterminated, undefined, text);
  return scan.segments.map((segment) => segment.expression);
}

test("scanner keeps static text and reports exact segment offsets", () => {
  const text = "a { value } b {other}";
  const scan = scanInterpolations(text);
  assert.equal(scan.unterminated, undefined);
  assert.deepEqual(scan.segments, [
    { start: 2, end: 11, expression: "value", expressionStart: 4 },
    { start: 14, end: 21, expression: "other", expressionStart: 15 },
  ]);
  assert.deepEqual(scanInterpolations("only } text").segments, []);
  assert.deepEqual(scanInterpolations("{}").segments, [{ start: 0, end: 2, expression: "", expressionStart: 1 }]);
});

test("scanner balances nested braces in object literals and arrow bodies", () => {
  assert.deepEqual(expressions("{ {a: 1}.a }"), ["{a: 1}.a"]);
  assert.deepEqual(expressions("{ ({ nested: { deep: 1 } }).nested.deep }"), ["({ nested: { deep: 1 } }).nested.deep"]);
  assert.deepEqual(expressions("{ items.map((item) => { return item; }) }"), ["items.map((item) => { return item; })"]);
});

test("scanner ignores braces inside strings, template literals and comments", () => {
  assert.deepEqual(expressions(`{ "}" + '{' + "\\"}" }`), [`"}" + '{' + "\\"}"`]);
  assert.deepEqual(expressions("{ `${count}px {` + `}` }"), ["`${count}px {` + `}`"]);
  assert.deepEqual(expressions("{ `a${ `b${ {c: 1}.c }` }` }"), ["`a${ `b${ {c: 1}.c }` }`"]);
  assert.deepEqual(expressions("{ `\\${` }"), ["`\\${`"]);
  assert.deepEqual(expressions("{ value /* } { */ }"), ["value /* } { */"]);
  assert.deepEqual(expressions("{ value // } {\n}"), ["value // } {\n"]);
});

test("scanner distinguishes regular expressions from division", () => {
  assert.deepEqual(expressions("{ /[}]/.test(value) }"), ["/[}]/.test(value)"]);
  assert.deepEqual(expressions("{ ok && /\\}/.test(value) }"), ["ok && /\\}/.test(value)"]);
  assert.deepEqual(expressions("{ total / count } / {(a) / 2}"), ["total / count", "(a) / 2"]);
});

test("scanner divides after postfix updates and keyword-named properties", () => {
  assert.deepEqual(expressions("{i++ / 2} de {n / 2}"), ["i++ / 2", "n / 2"]);
  assert.deepEqual(expressions("{i-- / 2} de {n / 2}"), ["i-- / 2", "n / 2"]);
  assert.deepEqual(expressions("{obj.return / x} y {z / 2}"), ["obj.return / x", "z / 2"]);
  assert.deepEqual(expressions("{ a + ++b }"), ["a + ++b"]);
});

test("scanner accepts a CRLF line continuation inside a string", () => {
  assert.deepEqual(expressions('{ "a\\\r\nb" }'), ['"a\\\r\nb"']);
});

test("template text decodes like the HTML parser: entities and CRLF", () => {
  assert.equal(decodeTemplateText("a &lt; b &copy; &amp;&amp; c"), "a < b © && c");
  assert.equal(decodeTemplateText("one\r\ntwo\rthree"), "one\ntwo\nthree");
  assert.equal(decodeTemplateText("a && b"), "a && b");
});

test("scanner reports the opening brace of an unterminated interpolation", () => {
  assert.equal(scanInterpolations("x { {a: 1} ").unterminated, 2);
  assert.equal(scanInterpolations("{ 'abc }").unterminated, 0);
  assert.equal(scanInterpolations("{ `a${ b }").unterminated, 0);
  assert.equal(scanInterpolations("{ value /* } ").unterminated, 0);
  const scan = scanInterpolations("ok {a} then { b");
  assert.deepEqual(scan.segments.map((segment) => segment.expression), ["a"]);
  assert.equal(scan.unterminated, 12);
});
