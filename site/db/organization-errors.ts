export class OrganizationError extends Error {
  constructor(message:string,readonly status:400|403|404|409|429|503=400){super(message);}
}
export const isId=(id:number)=>Number.isSafeInteger(id)&&id>0;
export function validId(id:number) {
  if(!isId(id))throw new OrganizationError("组织或成员不存在",404);
  return id;
}
export function cleanName(input:unknown,label="名称",limit=80) {
  if(typeof input!=="string")throw new OrganizationError(label+"不能为空");
  const name=input.trim();
  if(!name||name.length>limit||/[\u0000-\u001f\u007f]/.test(name))
    throw new OrganizationError(label+"必须为 1–"+limit+" 个字符");
  return name;
}
export function siblingConflict(error:unknown):never {
  if(error instanceof OrganizationError)throw error;
  if(error instanceof Error&&/UNIQUE constraint failed|SQLITE_CONSTRAINT|constraint failed/i.test(error.message))
    throw new OrganizationError("该层级已有同名部门，或此邀请已被其他请求处理",409);
  throw error;
}
