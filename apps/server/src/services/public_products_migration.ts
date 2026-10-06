import type {SqliteDatabase} from '@emergentinc/persistence';

/** Remove the V24 singleton constraint without changing any existing product or order row. */
export function migratePublicProducts(db:SqliteDatabase){
  const row=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='public_products'").get();
  if(!row)return;
  const sql=String(row.sql),constraint=/\s+CHECK\s*\(product_id\s*=\s*'custom-service'\)/i;
  if(!constraint.test(sql))return;
  db.exec('PRAGMA foreign_keys=OFF;');
  try{db.transaction(()=>{
    db.exec(sql.replace(/^CREATE TABLE\s+"?public_products"?/i,'CREATE TABLE public_products_multi').replace(constraint,''));
    db.exec('INSERT INTO public_products_multi SELECT * FROM public_products; DROP TABLE public_products; ALTER TABLE public_products_multi RENAME TO public_products;');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('PUBLIC_PRODUCTS_MIGRATION_FOREIGN_KEY_CONFLICT');
  });}finally{db.exec('PRAGMA foreign_keys=ON;');}
}
