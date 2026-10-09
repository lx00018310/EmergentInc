import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ToolContext, getArtifactsRoot } from '@emergentinc/tools';
import { lifeId } from '@emergentinc/protocol';
import { loadGeneAsset, readGeneCatalog } from './gene_promotion_service.js';

// V26 minimal Agent Skills subset: single-file Markdown with a flat `name`/`description`
// frontmatter. It is advisory documentation for Pixels, never an execution permission.
const SKILL_SUFFIX = '.skill.md';
const MAX_LISTED_BODY_SKILLS = 100;
const MAX_SKILL_BYTES = 32768;
const COORD_ID_PATTERN = /^-?\d+_-?\d+_-?\d+$/;
const SLUG_PATTERN = /^[\p{L}\p{N}_-]{1,100}$/u;

export interface SkillEntry {ref:string;name:string;description:string;origin:'body'|'gene';version?:number;size_bytes:number;updated_at?:number}
export interface SkillDiagnostic {ref:string;reason:string}
export interface SkillListing {skills:SkillEntry[];diagnostics:SkillDiagnostic[];truncated:boolean}
export interface SkillContent {ref:string;name:string;description:string;origin:'body'|'gene';version?:number;content:string;sha256:string;size_bytes:number}

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

/** Parses the single-line `name`/`description` frontmatter subset; anything else is rejected. */
export function parseSkillMarkdown(text:string):{name:string;description:string;body:string}{
  const lines=text.replace(/\r\n/g,'\n').split('\n');
  if(lines[0]!=='---')throw new Error('SKILL_FRONTMATTER_REQUIRED');
  let end=-1;
  for(let i=1;i<lines.length;i++)if(lines[i]==='---'){end=i;break;}
  if(end===-1)throw new Error('SKILL_FRONTMATTER_UNCLOSED');
  let name:string|undefined,description:string|undefined;
  for(const line of lines.slice(1,end)){
    if(!line.trim())continue;
    const match=/^([A-Za-z][A-Za-z0-9_-]*):[ ]?(.*)$/.exec(line);
    if(!match)throw new Error('SKILL_FRONTMATTER_UNSUPPORTED_SYNTAX');
    const key=match[1],raw=match[2]??'';
    if(!['name','description'].includes(key))throw new Error('SKILL_FRONTMATTER_UNKNOWN_FIELD');
    let value=raw.trim();
    if(value.length>=2&&((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))))value=value.slice(1,-1).trim();
    if(!value||/[\x00-\x1f\x7f]/.test(value))throw new Error('SKILL_FRONTMATTER_INVALID_VALUE');
    if(key==='name'&&value.length>100)throw new Error('SKILL_FRONTMATTER_NAME_TOO_LONG');
    if(key==='description'&&value.length>500)throw new Error('SKILL_FRONTMATTER_DESCRIPTION_TOO_LONG');
    if(key==='name')name=value;else description=value;
  }
  if(!name||!description)throw new Error('SKILL_FRONTMATTER_INCOMPLETE');
  return {name,description,body:lines.slice(end+1).join('\n')};
}

function pixelArtifactsDir(ctx:ToolContext):string{
  if(!COORD_ID_PATTERN.test(ctx.pixelId))throw new Error('INVALID_PIXEL_ID');
  return path.resolve(getArtifactsRoot(ctx),ctx.pixelId);
}

function listBodySkills(ctx:ToolContext):{entries:SkillEntry[];diagnostics:SkillDiagnostic[];truncated:boolean}{
  const entries:SkillEntry[]=[],diagnostics:SkillDiagnostic[]=[];
  let truncated=false;
  const dir=pixelArtifactsDir(ctx);
  if(!fs.existsSync(dir))return {entries,diagnostics,truncated};
  const names=fs.readdirSync(dir).filter(name=>name.endsWith(SKILL_SUFFIX)).sort();
  for(const file of names){
    const ref=`body:${file.slice(0,-SKILL_SUFFIX.length)}`;
    if(entries.length>=MAX_LISTED_BODY_SKILLS){truncated=true;break;}
    const full=path.join(dir,file);
    let stat:fs.Stats;
    try{stat=fs.lstatSync(full);}catch{diagnostics.push({ref,reason:'SKILL_FILE_UNREADABLE'});continue;}
    if(!stat.isFile()||stat.isSymbolicLink()){diagnostics.push({ref,reason:'SKILL_REGULAR_FILE_REQUIRED'});continue;}
    if(stat.size>MAX_SKILL_BYTES){diagnostics.push({ref,reason:'SKILL_TOO_LARGE'});continue;}
    let text:string;
    try{text=fs.readFileSync(full,'utf8');}catch{diagnostics.push({ref,reason:'SKILL_FILE_UNREADABLE'});continue;}
    try{
      const parsed=parseSkillMarkdown(text);
      entries.push({ref,name:parsed.name,description:parsed.description,origin:'body',size_bytes:stat.size,updated_at:Math.floor(stat.mtimeMs/1000)});
    }catch(error){diagnostics.push({ref,reason:error instanceof Error?error.message:String(error)});}
  }
  return {entries,diagnostics,truncated};
}

function geneSkillText(release:string,assetId:string):{text:string;version:number;contentHash:string}{
  const loaded=loadGeneAsset(release,assetId);
  if(loaded.asset.kind!=='knowledge')throw new Error('GENE_ASSET_NOT_A_SKILL');
  const text=(loaded.content as {content?:unknown}|null)?.content;
  if(typeof text!=='string')throw new Error('GENE_ASSET_NOT_A_SKILL');
  return {text,version:loaded.asset.version,contentHash:loaded.asset.contentHash};
}

function listGeneSkills(release:string):{entries:SkillEntry[];diagnostics:SkillDiagnostic[]}{
  const entries:SkillEntry[]=[],diagnostics:SkillDiagnostic[]=[];
  try{
    for(const asset of readGeneCatalog(release).assets){
      if(asset.kind!=='knowledge')continue;
      const ref=`gene:${asset.id}`;
      try{
        const gene=geneSkillText(release,asset.id),parsed=parseSkillMarkdown(gene.text);
        entries.push({ref,name:parsed.name,description:parsed.description,origin:'gene',version:gene.version,size_bytes:Buffer.byteLength(gene.text)});
      }catch(error){diagnostics.push({ref,reason:error instanceof Error?error.message:String(error)});}
    }
  }catch(error){diagnostics.push({ref:'gene:*',reason:error instanceof Error?error.message:String(error)});}
  return {entries,diagnostics};
}

function readBodySkill(ctx:ToolContext,slug:string):SkillContent{
  if(!SLUG_PATTERN.test(slug))throw new Error('INVALID_SKILL_REF');
  const file=path.resolve(pixelArtifactsDir(ctx),`${slug}${SKILL_SUFFIX}`);
  let stat:fs.Stats;
  try{stat=fs.lstatSync(file);}catch{throw new Error('SKILL_NOT_FOUND');}
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('SKILL_REGULAR_FILE_REQUIRED');
  if(stat.size>MAX_SKILL_BYTES)throw new Error('SKILL_TOO_LARGE');
  const text=fs.readFileSync(file,'utf8');
  const parsed=parseSkillMarkdown(text);
  return {ref:`body:${slug}`,name:parsed.name,description:parsed.description,origin:'body',content:text,sha256:hash(text),size_bytes:stat.size};
}

function readGeneSkill(release:string,assetId:string):SkillContent{
  lifeId(assetId);
  if(!readGeneCatalog(release).assets.some(asset=>asset.id===assetId&&asset.kind==='knowledge'))throw new Error('GENE_ASSET_NOT_FOUND');
  const gene=geneSkillText(release,assetId);
  const parsed=parseSkillMarkdown(gene.text);
  return {ref:`gene:${assetId}`,name:parsed.name,description:parsed.description,origin:'gene',version:gene.version,content:gene.text,sha256:gene.contentHash,size_bytes:Buffer.byteLength(gene.text)};
}

/** Merges the caller's own Body skill documents with approved Gene knowledge assets. */
export function listSkills(ctx:ToolContext,release:string):SkillListing{
  const body=listBodySkills(ctx),gene=listGeneSkills(release);
  return {skills:[...body.entries,...gene.entries],diagnostics:[...body.diagnostics,...gene.diagnostics],truncated:body.truncated};
}

/** Reads one skill by `LIST_SKILLS` ref: `body:<slug>` (own artifacts only) or `gene:<asset_id>`. */
export function readSkill(ctx:ToolContext,release:string,ref:unknown):SkillContent{
  if(typeof ref!=='string')throw new Error('INVALID_SKILL_REF');
  if(ref.startsWith('body:'))return readBodySkill(ctx,ref.slice('body:'.length));
  if(ref.startsWith('gene:'))return readGeneSkill(release,ref.slice('gene:'.length));
  throw new Error('INVALID_SKILL_REF');
}
