import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {lifeId} from '@emergentinc/protocol';
import {containedPath} from './safe_path.js';
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');

export interface GeneAsset {id:string;version:number;kind:string;file:string;contentHash:string;license:string}
export interface GeneCatalog {schema:1;assets:GeneAsset[]}
export function readGeneCatalog(release:string):GeneCatalog {
  const file=path.join(release,'genome/assets/index.json');if(!fs.existsSync(file))return {schema:1,assets:[]};
  const catalog=JSON.parse(fs.readFileSync(file,'utf8'));if(catalog.schema!==1||!Array.isArray(catalog.assets))throw new Error('GENE_CATALOG_INVALID');
  for(const asset of catalog.assets){lifeId(asset.id);if(!Number.isSafeInteger(asset.version)||asset.version<1||asset.file!==`assets/${asset.id}/${asset.version}.json`||!/^[a-f0-9]{64}$/.test(asset.contentHash))throw new Error('GENE_CATALOG_INVALID');}
  return catalog;
}
export function loadGeneAsset(release:string,id:string){
  lifeId(id);const asset=readGeneCatalog(release).assets.find(a=>a.id===id);if(!asset)throw new Error('GENE_ASSET_NOT_FOUND');
  const file=containedPath(path.join(release,'genome'),...asset.file.split('/')),bytes=fs.readFileSync(file);
  if(hash(bytes)!==asset.contentHash)throw new Error('GENE_ASSET_HASH_MISMATCH');return {asset,content:JSON.parse(bytes.toString('utf8'))};
}
