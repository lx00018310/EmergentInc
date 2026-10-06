import ts from 'typescript';
import { createHash } from 'node:crypto';

const closureTag=Symbol('pure-ast-closure'),mathTag=Symbol('pure-math');
type Environment={values:Map<string,any>;parent?:Environment};
type Closure={ [closureTag]:true; node:ts.FunctionExpression|ts.ArrowFunction|ts.FunctionDeclaration; environment:Environment };
const denied=new Set(['__proto__','prototype','constructor','caller','arguments']);
function clean(value:any,depth=0,budget={nodes:0,bytes:0}):any {
  if(++budget.nodes>10000)throw new Error('PURE_JSON_NODE_LIMIT');
  budget.bytes+=typeof value==='string'?Buffer.byteLength(value):8;if(budget.bytes>65536)throw new Error('PURE_JSON_BYTE_LIMIT');
  if(depth>40)throw new Error('PURE_JSON_DEPTH_LIMIT');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||Object.getOwnPropertySymbols(value).length||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))throw new Error('PURE_JSON_VALUE_REQUIRED');
  const result:any=Array.isArray(value)?[]:Object.create(null);
  for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(value))){
    if(Array.isArray(value)&&key==='length')continue;if(denied.has(key)||!('value'in descriptor))throw new Error('PURE_PROPERTY_DENIED');
    budget.bytes+=Buffer.byteLength(key);result[key]=clean(descriptor.value,depth+1,budget);
  }
  return result;
}
export function compilePureSkill(source:string){
  if(typeof source!=='string'||Buffer.byteLength(source)>65536)throw new Error('PURE_SOURCE_LIMIT');
  const file=ts.createSourceFile('skill.js',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
  if((file as any).parseDiagnostics.length||file.statements.length!==1||!ts.isExportAssignment(file.statements[0]!))throw new Error('PURE_DEFAULT_FUNCTION_REQUIRED');
  const expression=file.statements[0]!.expression;if(!ts.isArrowFunction(expression)&&!ts.isFunctionExpression(expression))throw new Error('PURE_DEFAULT_FUNCTION_REQUIRED');
  const supported=new Set([ts.SyntaxKind.SourceFile,ts.SyntaxKind.EndOfFileToken,ts.SyntaxKind.ExportAssignment,ts.SyntaxKind.ArrowFunction,ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.FunctionDeclaration,ts.SyntaxKind.Parameter,ts.SyntaxKind.Identifier,ts.SyntaxKind.Block,ts.SyntaxKind.ReturnStatement,ts.SyntaxKind.VariableStatement,
    ts.SyntaxKind.VariableDeclarationList,ts.SyntaxKind.VariableDeclaration,ts.SyntaxKind.IfStatement,ts.SyntaxKind.ExpressionStatement,
    ts.SyntaxKind.NumericLiteral,ts.SyntaxKind.StringLiteral,ts.SyntaxKind.NoSubstitutionTemplateLiteral,ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.ParenthesizedExpression,ts.SyntaxKind.ArrayLiteralExpression,ts.SyntaxKind.ObjectLiteralExpression,ts.SyntaxKind.PropertyAssignment,ts.SyntaxKind.ShorthandPropertyAssignment,
    ts.SyntaxKind.PropertyAccessExpression,ts.SyntaxKind.ElementAccessExpression,ts.SyntaxKind.CallExpression,ts.SyntaxKind.BinaryExpression,ts.SyntaxKind.PrefixUnaryExpression,
    ts.SyntaxKind.ConditionalExpression,ts.SyntaxKind.TypeOfExpression,ts.SyntaxKind.EqualsGreaterThanToken,ts.SyntaxKind.QuestionToken,ts.SyntaxKind.ColonToken,
    ts.SyntaxKind.PlusToken,ts.SyntaxKind.MinusToken,ts.SyntaxKind.AsteriskToken,ts.SyntaxKind.SlashToken,ts.SyntaxKind.PercentToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.GreaterThanToken,ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.LessThanToken,ts.SyntaxKind.LessThanEqualsToken,ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.EqualsToken]);
  const inspect=(node:ts.Node)=>{if(!supported.has(node.kind))throw new Error('PURE_SYNTAX_NOT_SUPPORTED');
    if(ts.isIdentifier(node)&&['process','require','globalThis','global','eval','Function','fetch','WebSocket','import','Buffer'].includes(node.text))throw new Error('PURE_HOST_ACCESS_DENIED');
    ts.forEachChild(node,inspect);};inspect(file);
  return {file,expression,sourceHash:createHash('sha256').update(source).digest('hex')};
}
/** Interpret an explicit JSON-only JS subset. Source is never evaluated by JS/vm and has no host objects. */
export function runPureSkill(source:string,input:unknown){
  const compiled=compilePureSkill(source),data=clean(input);
  if(Buffer.byteLength(JSON.stringify(data))>65536)throw new Error('PURE_INPUT_LIMIT');
  let steps=0,depth=0;
  const lookup=(environment:Environment,name:string):any=>{if(environment.values.has(name))return environment.values.get(name);if(environment.parent)return lookup(environment.parent,name);throw new Error('PURE_IDENTIFIER_UNAVAILABLE');};
  const key=(value:any)=>{if(!['string','number'].includes(typeof value))throw new Error('PURE_PROPERTY_KEY_REQUIRED');const name=String(value);if(denied.has(name)||name.length>200)throw new Error('PURE_PROPERTY_DENIED');return name;};
  const tick=()=>{if(++steps>20000)throw new Error('PURE_STEP_LIMIT');};
  const invoke=(fn:any,args:any[])=>{tick();if(!fn?.[closureTag])throw new Error('PURE_CALL_DENIED');
    const environment:Environment={values:new Map(),parent:fn.environment};
    fn.node.parameters.forEach((parameter:ts.ParameterDeclaration,i:number)=>{if(!ts.isIdentifier(parameter.name))throw new Error('PURE_PARAMETER_REQUIRED');environment.values.set(parameter.name.text,args[i]);});
    if(ts.isBlock(fn.node.body))return block(fn.node.body,environment).value;
    return evaluate(fn.node.body,environment);
  };
  const method=(receiver:any,name:string,args:any[])=>{
    key(name);tick();
    if(receiver===mathTag&&['abs','floor','ceil','round','min','max','sqrt','pow'].includes(name)){
      if(args.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('PURE_MATH_ARGUMENT');return (Math as any)[name](...args);
    }
    if(Array.isArray(receiver)){
      if(name==='map')return receiver.map((value,index)=>invoke(args[0],[value,index]));
      if(name==='filter')return receiver.filter((value,index)=>invoke(args[0],[value,index]));
      if(name==='reduce'){if(args.length!==2)throw new Error('PURE_REDUCE_INITIAL_REQUIRED');let accumulator=args[1];for(let i=0;i<receiver.length;i++)accumulator=invoke(args[0],[accumulator,receiver[i],i]);return accumulator;}
      if(name==='slice'){if(args.some(v=>!Number.isSafeInteger(v)))throw new Error('PURE_INDEX_REQUIRED');return receiver.slice(...args);}
      if(name==='join'){if(receiver.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v))||(args[0]!==undefined&&typeof args[0]!=='string'))throw new Error('PURE_JOIN_SCALAR_REQUIRED');
        if(receiver.reduce((sum,v)=>sum+String(v).length+(args[0]?.length??1),0)>65536)throw new Error('PURE_OUTPUT_LIMIT');return receiver.join(args[0]);}
      if(name==='includes')return receiver.includes(args[0]);
    }
    if(typeof receiver==='string'){
      if(name==='trim')return receiver.trim();if(name==='toLowerCase')return receiver.toLowerCase();if(name==='toUpperCase')return receiver.toUpperCase();
      if(name==='split'&&typeof args[0]==='string')return receiver.split(args[0]);if(name==='slice'){if(args.some(v=>!Number.isSafeInteger(v)))throw new Error('PURE_INDEX_REQUIRED');return receiver.slice(...args);}if(name==='includes'&&typeof args[0]==='string')return receiver.includes(args[0]);
    }
    throw new Error('PURE_METHOD_DENIED');
  };
  const block=(node:ts.Block,environment:Environment):{returned:boolean;value?:any}=>{
    for(const statement of node.statements){tick();
      if(ts.isReturnStatement(statement))return {returned:true,value:statement.expression?evaluate(statement.expression,environment):undefined};
      if(ts.isVariableStatement(statement)){for(const variable of statement.declarationList.declarations){if(!ts.isIdentifier(variable.name)||!variable.initializer)throw new Error('PURE_VARIABLE_REQUIRED');environment.values.set(variable.name.text,evaluate(variable.initializer,environment));}}
      else if(ts.isFunctionDeclaration(statement)&&statement.name)environment.values.set(statement.name.text,{[closureTag]:true,node:statement,environment});
      else if(ts.isIfStatement(statement)){const chosen=evaluate(statement.expression,environment)?statement.thenStatement:statement.elseStatement;
        if(chosen){if(ts.isBlock(chosen)){const result=block(chosen,environment);if(result.returned)return result;}else if(ts.isReturnStatement(chosen))return {returned:true,value:chosen.expression?evaluate(chosen.expression,environment):undefined};else throw new Error('PURE_IF_BLOCK_REQUIRED');}}
      else if(ts.isExpressionStatement(statement))evaluate(statement.expression,environment);
      else throw new Error('PURE_STATEMENT_DENIED');
    }return {returned:false};
  };
  const evaluate=(node:ts.Node,environment:Environment):any=>{
    tick();if(++depth>100)throw new Error('PURE_DEPTH_LIMIT');
    try{
      if(ts.isParenthesizedExpression(node))return evaluate(node.expression,environment);
      if(ts.isNumericLiteral(node))return Number(node.text);if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
      if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
      if(ts.isIdentifier(node))return lookup(environment,node.text);
      if(ts.isArrayLiteralExpression(node))return node.elements.map(value=>evaluate(value,environment));
      if(ts.isObjectLiteralExpression(node)){const result:any=Object.create(null);for(const property of node.properties){
        if(ts.isShorthandPropertyAssignment(property))result[key(property.name.text)]=lookup(environment,property.name.text);
        else if(ts.isPropertyAssignment(property)&&!ts.isComputedPropertyName(property.name))result[key(property.name.getText(compiled.file).replace(/^['"]|['"]$/g,''))]=evaluate(property.initializer,environment);
        else throw new Error('PURE_OBJECT_PROPERTY_REQUIRED');}return result;}
      if(ts.isArrowFunction(node)||ts.isFunctionExpression(node))return {[closureTag]:true,node,environment} as Closure;
      if(ts.isConditionalExpression(node))return evaluate(evaluate(node.condition,environment)?node.whenTrue:node.whenFalse,environment);
      if(ts.isTypeOfExpression(node))return typeof evaluate(node.expression,environment);
      if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){const receiver=evaluate(node.expression,environment),name=key(ts.isPropertyAccessExpression(node)?node.name.text:evaluate(node.argumentExpression,environment));
        if(name==='length'&&(typeof receiver==='string'||Array.isArray(receiver)))return receiver.length;
        if(!receiver||typeof receiver!=='object'||receiver[closureTag])throw new Error('PURE_PROPERTY_RECEIVER');return Object.hasOwn(receiver,name)?receiver[name]:undefined;}
      if(ts.isCallExpression(node)){const args=node.arguments.map(arg=>evaluate(arg,environment));
        if(ts.isPropertyAccessExpression(node.expression))return method(evaluate(node.expression.expression,environment),node.expression.name.text,args);
        return invoke(evaluate(node.expression,environment),args);}
      if(ts.isPrefixUnaryExpression(node)){const value=evaluate(node.operand,environment);if(node.operator===ts.SyntaxKind.ExclamationToken)return !value;
        if(typeof value!=='number')throw new Error('PURE_NUMERIC_OPERAND_REQUIRED');
        if(node.operator===ts.SyntaxKind.MinusToken)return -value;if(node.operator===ts.SyntaxKind.PlusToken)return +value;throw new Error('PURE_UNARY_DENIED');}
      if(ts.isBinaryExpression(node)){const op=node.operatorToken.kind,left=evaluate(node.left,environment);
        if(op===ts.SyntaxKind.AmpersandAmpersandToken)return left&&evaluate(node.right,environment);
        if(op===ts.SyntaxKind.BarBarToken)return left||evaluate(node.right,environment);
        if(op===ts.SyntaxKind.QuestionQuestionToken)return left??evaluate(node.right,environment);
        const right=evaluate(node.right,environment);
        if(![ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.EqualsToken].includes(op)&&
          (!["number","string"].includes(typeof left)||!["number","string"].includes(typeof right)))throw new Error('PURE_SCALAR_OPERAND_REQUIRED');
        if(op===ts.SyntaxKind.PlusToken&&String(left).length+String(right).length>65536)throw new Error('PURE_OUTPUT_LIMIT');
        switch(op){case ts.SyntaxKind.PlusToken:return left+right;case ts.SyntaxKind.MinusToken:return left-right;case ts.SyntaxKind.AsteriskToken:return left*right;case ts.SyntaxKind.SlashToken:return left/right;case ts.SyntaxKind.PercentToken:return left%right;
          case ts.SyntaxKind.EqualsEqualsEqualsToken:return left===right;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return left!==right;case ts.SyntaxKind.GreaterThanToken:return left>right;
          case ts.SyntaxKind.GreaterThanEqualsToken:return left>=right;case ts.SyntaxKind.LessThanToken:return left<right;case ts.SyntaxKind.LessThanEqualsToken:return left<=right;
          case ts.SyntaxKind.EqualsToken:if(ts.isIdentifier(node.left)&&environment.values.has(node.left.text)){environment.values.set(node.left.text,right);return right;}throw new Error('PURE_ASSIGNMENT_DENIED');
          default:throw new Error('PURE_OPERATOR_DENIED');}}
      throw new Error('PURE_EXPRESSION_DENIED');
    }finally{depth--;}
  };
  const environment:Environment={values:new Map<string,any>([['Math',mathTag],['undefined',undefined]])};
  const result=clean(invoke({[closureTag]:true,node:compiled.expression,environment},[data]));
  if(Buffer.byteLength(JSON.stringify(result))>65536)throw new Error('PURE_OUTPUT_LIMIT');
  return result;
}
