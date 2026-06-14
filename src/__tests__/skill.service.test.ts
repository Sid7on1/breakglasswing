import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillService, parseSkillFile } from '../skills/skill.service';
import { createSkillTool } from '../tools/implementations/skill.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

function writeSkill(root: string, name: string, frontmatter: string, body: string) {
  const dir = path.join(root, '.bimax', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

describe('parseSkillFile', () => {
  it('extracts frontmatter and body', () => {
    const { meta, body } = parseSkillFile('---\nname: x\ndescription: does x\n---\nstep one');
    expect(meta.name).toBe('x');
    expect(meta.description).toBe('does x');
    expect(body).toBe('step one');
  });

  it('treats a file with no frontmatter as all body', () => {
    const { meta, body } = parseSkillFile('just instructions');
    expect(meta).toEqual({});
    expect(body).toBe('just instructions');
  });
});

describe('SkillService', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-skill-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('discovers a SKILL.md and exposes name + description for the prompt', () => {
    writeSkill(dir, 'pdf-fill', 'name: pdf-fill\ndescription: Fill PDF forms from JSON', 'do it');
    const svc = new SkillService();
    svc.load(dir);
    expect(svc.list().map(s => s.name)).toContain('pdf-fill');
    expect(svc.listForPrompt()).toContain('pdf-fill: Fill PDF forms from JSON');
  });

  it('skips a SKILL.md with no description', () => {
    writeSkill(dir, 'broken', 'name: broken', 'body');
    const svc = new SkillService();
    svc.load(dir);
    expect(svc.get('broken')).toBeUndefined();
  });

  it('renderBody returns full instructions and lists bundled files', () => {
    const skillDir = writeSkill(dir, 'demo', 'name: demo\ndescription: demo skill', 'STEP ONE');
    fs.writeFileSync(path.join(skillDir, 'helper.py'), 'print(1)');
    const svc = new SkillService();
    svc.load(dir);
    const body = svc.renderBody('demo');
    expect(body).toContain('STEP ONE');
    expect(body).toContain('helper.py');
  });

  it('renderBody on an unknown skill lists what is available', () => {
    writeSkill(dir, 'demo', 'name: demo\ndescription: demo skill', 'x');
    const svc = new SkillService();
    svc.load(dir);
    expect(svc.renderBody('nope')).toContain('demo');
  });
});

describe('SkillTool', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-skilltool-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('loads a skill body by name', async () => {
    writeSkill(dir, 'greet', 'name: greet\ndescription: greet the user', 'SAY HELLO');
    const svc = new SkillService();
    svc.load(dir);
    const tool = createSkillTool(governor, svc);
    const out = await tool.execute({ name: 'greet' }, {});
    expect(out).toContain('SAY HELLO');
  });
});
