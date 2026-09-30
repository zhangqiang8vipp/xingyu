export const PUBLIC_REVISION_POINTER_TTL_MS=5_000;

type RevisionReader=(category?:string)=>Promise<string|null>;
type RevisionPointer={revision:string;expiresAt:number};

type PublicRevisionCacheOptions={
  ttlMs?:number;
  now?:()=>number;
};

function isValidRevision(revision:string|null):revision is string{
  return revision!==null&&/^[1-9]\d*$/.test(revision);
}

function revisionPointerKey(category?:string):string{
  return category===undefined?"all":`category:${category}`;
}

export function createPublicRevisionCache(options:PublicRevisionCacheOptions={}){
  const ttlMs=options.ttlMs??PUBLIC_REVISION_POINTER_TTL_MS;
  const now=options.now??Date.now;
  const pointers=new Map<string,RevisionPointer>();
  const refreshes=new Map<string,Promise<string|null>>();

  return {
    async read(category:string|undefined,reader:RevisionReader):Promise<string|null>{
      const key=revisionPointerKey(category);
      const currentTime=now();
      const pointer=pointers.get(key);
      if(pointer&&pointer.expiresAt>currentTime&&isValidRevision(pointer.revision))return pointer.revision;

      // Bounded eventual consistency: a successful pointer lives for at most
      // five seconds. Expired or malformed pointers are removed before refresh,
      // so a failed refresh can never fall back to stale cached HTML indefinitely.
      pointers.delete(key);
      const inFlight=refreshes.get(key);
      if(inFlight)return inFlight;

      const refresh=(async()=>{
        const revision=await reader(category);
        if(!isValidRevision(revision))return null;
        pointers.set(key,{revision,expiresAt:now()+ttlMs});
        return revision;
      })().catch(()=>null).finally(()=>{
        refreshes.delete(key);
      });
      refreshes.set(key,refresh);
      return refresh;
    },
  };
}

const publicRevisionCache=createPublicRevisionCache();

export function readCachedPublicContentRevision(category:string|undefined,reader:RevisionReader):Promise<string|null>{
  return publicRevisionCache.read(category,reader);
}
