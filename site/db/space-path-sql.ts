// Correlated to the post alias `p` used by all authenticated article readers.
// The visited-ID guard prevents malformed historical space cycles from making
// a reader query recurse indefinitely.
export const spacePathSql = `(
  WITH RECURSIVE ancestors(id,parent_id,name,depth,visited) AS (
    SELECT id,parent_id,name,0,',' || id || ',' FROM spaces WHERE id=p.space_id
    UNION ALL
    SELECT s.id,s.parent_id,s.name,ancestors.depth+1,ancestors.visited || s.id || ','
    FROM spaces s JOIN ancestors ON s.id=ancestors.parent_id
    WHERE instr(ancestors.visited,',' || s.id || ',')=0
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ancestors)
    OR (SELECT parent_id FROM ancestors ORDER BY depth DESC LIMIT 1) IS NOT NULL
    THEN '层级异常'
    ELSE (SELECT group_concat(name,' / ') FROM (SELECT name FROM ancestors ORDER BY depth DESC))
  END
)`;
