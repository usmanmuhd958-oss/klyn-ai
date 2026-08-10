// KLYN AI OS — Regression suite for the patch planner (audit fix #7) and
// validator (audit fix #6): regex-escape safety and babel-based syntax
// validation with real error positions.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PatchPlanner } from '../dist/1.brain/patch_planner.js';
import { PatchValidator } from '../dist/1.brain/patch_validator.js';

describe('patch planner', () => {
  test('ruleModify escapes regex metacharacters in symbols', () => {
    const planner = new PatchPlanner();
    // A symbol with a regex metacharacter used to throw / misbehave.
    const out = planner['ruleModify']('const a = 1; // fix (a)', ['(a']);
    assert.equal(out, 'const a = 1; // fix Updated(a)');
  });

  test('ruleModify handles symbols with $, + and .', () => {
    const planner = new PatchPlanner();
    const content = 'cost = 5; total = cost + 1;';
    const out = planner['ruleModify'](content, ['cost']);
    assert.ok(out.includes('Updatedcost'));
    assert.ok(out.includes('total = Updatedcost + 1;'));
  });

  test('planFromOperations produces deterministic planHash', () => {
    const planner = new PatchPlanner();
    const p1 = planner.planFromOperations(
      [{ type: 'create', path: 'a.ts', content: 'x' }],
      'q',
      'create'
    );
    const p2 = planner.planFromOperations(
      [{ type: 'create', path: 'a.ts', content: 'x' }],
      'q',
      'create'
    );
    assert.equal(p1.planHash, p2.planHash);
    assert.equal(p1.files.length, 1);
    assert.equal(p1.inverse.length, 1);
    assert.equal(p1.inverse[0].type, 'delete');
  });
});

describe('patch validator', () => {
  const v = new PatchValidator();

  test('accepts valid TypeScript', async () => {
    const errs = await v['validateSyntax'](
      'export function f(a: number): string {\n  const s = "}"; // brace in string\n  return `${a}`;\n}\n',
      '/tmp/x.ts'
    );
    assert.deepEqual(errs, []);
  });

  test('rejects unbalanced braces with a line number (old impl missed this)', async () => {
    const errs = await v['validateSyntax']('function f() {\n  return 1;\n', '/tmp/x.ts');
    assert.ok(errs.length > 0, 'expected a syntax error');
    assert.equal(errs[0].type, 'syntax');
    assert.ok(errs[0].line >= 1);
  });

  test('does not false-positive on braces inside strings/templates/comments', async () => {
    const code = [
      '// } not a brace',
      'const a = "{" + "}";',
      'const t = `{{ ${1} }}`;',
      'const re = /[{}]/g;',
      'export const ok = true;',
    ].join('\n');
    const errs = await v['validateSyntax'](code, '/tmp/ok.ts');
    assert.deepEqual(errs, []);
  });

  test('accepts .jsx/.tsx via plugin selection', async () => {
    const errs = await v['validateSyntax'](
      'export const el = <div className="x">{1 + 1}</div>;',
      '/tmp/el.tsx'
    );
    assert.deepEqual(errs, []);
  });

  test('resolveRelativePath handles .. and .', async () => {
    const got = await v['resolveRelativePath']('../a/b', '/repo/src/index.ts');
    assert.equal(got, '/repo/a/b');
  });
});
