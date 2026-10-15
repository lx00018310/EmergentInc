import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const shaPattern=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export function git(root,args,input){return execFileSync('git',args,{cwd:root,input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
export function commitSha(root,sha){
  if(typeof sha!=='string'||!shaPattern.test(sha))throw new Error('GIT_COMMIT_INVALID');
  try{if(git(root,['rev-parse',`${sha}^{commit}`])===sha)return sha;}catch{}
  throw new Error('GIT_COMMIT_NOT_FOUND');
}
export function isAncestor(root,ancestor,tip){
  try{git(root,['merge-base','--is-ancestor',ancestor,tip]);return true;}catch(error){if(error.status===1)return false;throw error;}
}
function worktrees(root){return git(root,['worktree','list','--porcelain']).split(/\r?\n\r?\n/).map(block=>{
  const lines=block.split(/\r?\n/);return {directory:lines.find(l=>l.startsWith('worktree '))?.slice(9),branch:lines.find(l=>l.startsWith('branch '))?.slice(7)};
});}
function cleanCheckout(root){
  if(git(root,['status','--porcelain']))throw new Error('GIT_SYNC_DIRTY_WORKTREE');
  for(const marker of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']){
    if(fs.existsSync(path.resolve(root,git(root,['rev-parse','--git-path',marker]))))throw new Error('GIT_OPERATION_IN_PROGRESS');
  }
  if(worktrees(root).some(w=>w.branch==='refs/heads/main'&&fs.realpathSync(w.directory)!==fs.realpathSync(root)))throw new Error('GIT_MAIN_OTHER_WORKTREE');
}
export function inspectSwitch(root,sourceCommit,expectedMain,mode){
  commitSha(root,sourceCommit);cleanCheckout(root);
  const main=git(root,['rev-parse','refs/heads/main']);
  if(expectedMain!==main)throw new Error('GIT_SYNC_MAIN_MOVED');
  const historical=sourceCommit!==main&&isAncestor(root,sourceCommit,main);
  if(mode!==undefined&&!['merge','restore'].includes(mode)||mode==='restore'&&!historical)throw new Error('VERSION_UPGRADE_ACTION_INVALID');
  return {sourceCommit,main,head:git(root,['rev-parse','HEAD']),branch:git(root,['symbolic-ref','--quiet','HEAD']),mode:mode??(historical?'restore':'merge')};
}
export function checkSwitch(root,plan){
  cleanCheckout(root);
  if(git(root,['rev-parse','refs/heads/main'])!==plan.main)throw new Error('GIT_SYNC_MAIN_MOVED');
  if(git(root,['rev-parse','HEAD'])!==plan.head||git(root,['symbolic-ref','--quiet','HEAD'])!==plan.branch)throw new Error('GIT_CHECKOUT_CHANGED');
}
/** Build the exact result without changing main, the index or the development checkout. */
export function buildSwitch(root,plan){
  checkSwitch(root,plan);
  let tree,parents=[plan.main];
  if(plan.mode==='merge'&&isAncestor(root,plan.sourceCommit,plan.main))return {...plan,commit:plan.main};
  if(plan.mode==='restore')tree=git(root,['rev-parse',`${plan.sourceCommit}^{tree}`]);
  else{
    let output;
    try{output=git(root,['merge-tree','--write-tree','--name-only',plan.main,plan.sourceCommit]);}
    catch(error){
      if(error.status!==1)throw error;
      const lines=String(error.stdout).split(/\r?\n/).slice(1),end=lines.indexOf('');
      throw Object.assign(new Error('GIT_MERGE_CONFLICT'),{conflicts:lines.slice(0,end<0?lines.length:end)});
    }
    tree=output.split(/\r?\n/)[0];parents.push(plan.sourceCommit);
  }
  const message=plan.mode==='restore'?`Restore source tree from ${plan.sourceCommit}\n\nPreserve main history; business data is unchanged.\n`:`Merge ${plan.sourceCommit} into main\n`;
  const commit=git(root,['commit-tree',tree,...parents.flatMap(parent=>['-p',parent])],message);
  const recoveryRef=`refs/emergentinc/switches/${randomUUID()}`;
  git(root,['update-ref',recoveryRef,commit,'0'.repeat(commit.length)]);
  return {...plan,commit,recoveryRef};
}
/** Called only after the release is healthy. Retry never republishes the software. */
export function syncSwitch(root,plan){
  cleanCheckout(root);
  const main=git(root,['rev-parse','refs/heads/main']),head=git(root,['rev-parse','HEAD']),branch=git(root,['symbolic-ref','--quiet','HEAD']);
  if(main!==plan.main&&main!==plan.commit)throw new Error('GIT_SYNC_MAIN_MOVED');
  if(!(head===plan.head&&branch===plan.branch)&&!(head===plan.commit&&branch==='refs/heads/main'))throw new Error('GIT_CHECKOUT_CHANGED');
  if(!isAncestor(root,plan.main,plan.commit))throw new Error('GIT_COMMIT_NOT_FAST_FORWARDABLE');
  if(main!==plan.commit){
    if(branch==='refs/heads/main')git(root,['merge','--ff-only',plan.commit]);
    else git(root,['update-ref','refs/heads/main',plan.commit,plan.main]);
  }
  if(branch!=='refs/heads/main')git(root,['switch','main']);
  if(git(root,['rev-parse','HEAD'])!==plan.commit)throw new Error('GIT_SYNC_INCOMPLETE');
  // Migrate only the legacy local develop branch, and only after retaining all its commits.
  const develop=git(root,['for-each-ref','--format=%(objectname)','refs/heads/develop']);
  if(develop&&isAncestor(root,develop,plan.commit)&&!worktrees(root).some(w=>w.branch==='refs/heads/develop'))git(root,['update-ref','-d','refs/heads/develop',develop]);
}
function deletable(root,branch,sha,activeSource){
  const ref=`refs/heads/${branch}`;
  if(branch==='main'||!branch||branch.startsWith('-'))return false;
  try{git(root,['check-ref-format',ref]);}catch{return false;}
  if(git(root,['for-each-ref','--format=%(objectname)',ref])!==sha)return false;
  if(worktrees(root).some(w=>w.branch===ref))return false;
  const protectedTips=[git(root,['rev-parse','refs/heads/main']),git(root,['rev-parse','HEAD'])];
  if(activeSource)protectedTips.push(commitSha(root,activeSource));
  return protectedTips.every(tip=>!isAncestor(root,sha,tip));
}
export function deletableBranches(root,sha,activeSource){
  return git(root,['for-each-ref','--format=%(refname:strip=2)','--points-at',sha,'refs/heads']).split(/\r?\n/).filter(branch=>deletable(root,branch,sha,activeSource));
}
export function deleteBranch(root,branch,sha,activeSource){
  commitSha(root,sha);
  if(typeof branch!=='string'||!deletable(root,branch,sha,activeSource))throw new Error('GIT_BRANCH_DELETE_DENIED');
  const recoveryRef=`refs/emergentinc/discarded/${randomUUID()}`;
  // Keep recovery objects, delete only the exact local tip, and leave remotes/tags/releases alone.
  git(root,['update-ref','--stdin'],`start\ncreate ${recoveryRef} ${sha}\ndelete refs/heads/${branch} ${sha}\nprepare\ncommit\n`);
  return {branch,sha,recoveryRef};
}
