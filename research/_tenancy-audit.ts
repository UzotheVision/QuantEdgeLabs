import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

(async () => {
  const r: any = await db.execute(sql`
    SELECT c.table_name, COUNT(*) FILTER (WHERE c.column_name IN ('user_id','userId')) AS has_user
    FROM information_schema.columns c
    WHERE c.table_schema='public'
    GROUP BY c.table_name ORDER BY c.table_name`);
  const rows = (r.rows ?? r) as any[];
  const withUser = rows.filter((x) => Number(x.has_user) > 0).map((x) => x.table_name);
  const without = rows.filter((x) => Number(x.has_user) === 0).map((x) => x.table_name);

  console.log('\n\n########## TENANCY AUDIT ##########');
  console.log(`\n  tables WITH user_id (${withUser.length}):`);
  console.log('    ' + withUser.join(', '));
  console.log(`\n  tables WITHOUT user_id (${without.length}) — shared/global by construction:`);
  console.log('    ' + without.join(', '));

  // Of the per-user tables, how many rows are unowned?
  console.log('\n  unowned rows in per-user tables:');
  for (const t of withUser) {
    try {
      const q: any = await db.execute(sql.raw(
        `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE user_id IS NULL)::int orphan FROM "${t}"`));
      const { total, orphan } = (q.rows ?? q)[0];
      if (total > 0) console.log(`    ${t.padEnd(30)} ${orphan}/${total} have NULL user_id`);
    } catch { /* view or odd type */ }
  }
  process.exit(0);
})();
