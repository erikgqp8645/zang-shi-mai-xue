#!/usr/bin/env python3
'''
从「方剂主表」Excel（= 已核对过的归一结果）＋原始 JSON，生成 5 张表的 SQLite 库。

    python3 scripts/build-formula-db.py
    → local-data/formulas.db（运行产物，已在 .gitignore 里）

为什么以 Excel 为输入：那张表是人工核对过、用户正在看的归一结果；
库和表必须同一口径，否则「表里合并了、库里还是四份」。
原始 JSON 仍是唯一真相 —— Excel 也是从它生成的，这里只是取它的**归一映射**。
'''
import json, re, sqlite3, hashlib, os, sys
from openpyxl import load_workbook

BASE='src/content/'
XLSX='exports/方剂主表-2026-11-21.xlsx'
DB='local-data/formulas.db'
SCHEMA='scripts/schema-formulas.sql'

CN={'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10'}
def name_key(n):
    t=re.sub(r'[（(].*?[）)]','',n).replace('＋','+')
    t=re.split(r'\s*\+\s*',t)[0]
    t=re.sub(r'([一二三四五六七八九十])号', lambda m: CN[m.group(1)]+'号', t)
    t=re.sub(r'\s+','',t)
    return re.sub(r'(饮子|汤|散|丸|饮|丹|方)$','',t).strip()

def split_base(n):
    m=re.match(r'^([^（(]+)[（(](.+?)[）)]\s*$', n)
    return (m.group(1).strip(), m.group(2).strip()) if m else (n.strip(), '')

doses=json.load(open(BASE+'doses.json',encoding='utf-8'))
drugs=json.load(open(BASE+'drugs.json',encoding='utf-8'))
rules=json.load(open(BASE+'formula-rules.json',encoding='utf-8'))['rules']
pats=json.load(open(BASE+'pulse-patterns.json',encoding='utf-8'))['patterns']

dose_by_name={x['name']:x for x in doses['doses']}
drug_by_name={x['name']:x for x in drugs['drugs']}
sci_by_doseid={x['id']:x.get('ratio','') for x in doses.get('sciences',[]) if isinstance(x,dict)}
sci_code=doses.get('scienceByDoseId',{})

ws=load_workbook(XLSX)['方剂主表']
hdr=[c.value for c in ws[1]]
rows=[dict(zip(hdr,r)) for r in ws.iter_rows(min_row=2, values_only=True)]

def fid(name, dose, drug):
    if dose and dose in dose_by_name: return dose_by_name[dose]['id']
    if drug and drug in drug_by_name: return drug_by_name[drug]['id']
    # ⚠️ 兜底 id 要用**完整规范名**算哈希：用归一名会把
    #    「六神」与「六神（苓为君）」「四君子汤 + 温热药」这类不同写法撞成一个 id。
    return 'f-'+hashlib.md5(re.sub(r'\s+','',name).encode('utf-8')).hexdigest()[:10]

conn=sqlite3.connect(DB)
conn.executescript(open(SCHEMA,encoding='utf-8').read())
# 老库补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列
cols={r[1] for r in conn.execute('PRAGMA table_info(formulas)')}
if 'dose_id' not in cols:
    conn.execute('ALTER TABLE formulas ADD COLUMN dose_id TEXT')
    print('   （迁移）formulas 补列 dose_id')
conn.execute('DELETE FROM rule_formulas'); conn.execute('DELETE FROM formula_patterns')
conn.execute('DELETE FROM formula_aliases'); conn.execute('DELETE FROM formulas')
conn.execute('DELETE FROM formula_rules')

alias_index={}   # 写法 → formula_id
formula_id_by_name={}

for r in rows:
    name=r['规范名']; drug=r.get('别名1（讲稿 2010）') or None; dose=r.get('别名2（同和堂版）') or None
    # 别名列里空着的情况：规范名本身就是那条资料的名字
    if not dose and name in dose_by_name: dose=name
    if not drug and name in drug_by_name: drug=name
    key=fid(name, dose, drug)
    b,q=split_base(name)
    d=dose_by_name.get(dose or '',{}); g=drug_by_name.get(drug or '',{})
    sci=''
    if dose in dose_by_name:
        did=dose_by_name[dose]['id']; code=sci_code.get(did); sci=sci_by_doseid.get(code,'') if code else ''
    conn.execute('''INSERT OR REPLACE INTO formulas
      (id,name,base_name,qualifier,relation,p42_no,p42_indication,dose_id,composition_th,composition_draft,
       science,usage,adjustments,contraindications,note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(
      key,name,b,q,r.get('关系',''),
      (r.get('讲义 p42 行号') or r.get('p42 行号') or None),
      (r.get('讲义 p42 对应脉象及加减') or r.get('p42 对应脉象及加减') or ''),
      (d.get('id') if (dose and dose in dose_by_name) else None),
      (d.get('composition') or ''), (g.get('composition') or ''), sci,
      g.get('usage') or '', '；'.join(g.get('adjustments') or []), g.get('contraindication') or '',
      (r.get('备注') or '')))
    formula_id_by_name[name]=key
    src_of_name = '讲义 p42' if (r.get('讲义 p42 行号') or r.get('p42 行号')) else ('同和堂版' if (dose and dose in dose_by_name) else ('讲稿 2010' if (drug and drug in drug_by_name) else '讲义 p44'))
    for src,nm in ((src_of_name, name), ('讲稿 2010', drug), ('同和堂版', dose)):
        if nm:
            conn.execute('INSERT OR IGNORE INTO formula_aliases (formula_id,source,name) VALUES (?,?,?)',(key,src,nm))
            alias_index.setdefault(nm,key)

# 规则 + 脉象图
for r in rules:
    conn.execute('''INSERT OR REPLACE INTO formula_rules
      (id,route,condition,therapy,kind,wuxing,side,always,visible,adds,drugs,source,quote)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)''',(
      r['id'], r.get('route',''), r.get('condition',''), r.get('therapy',''), r.get('kind',''),
      r.get('wuxing',''), r.get('side',''), 1 if r.get('always') else 0, 0 if r.get('visible') is False else 1,
      '、'.join(r.get('adds') or []), ','.join(r.get('drugs') or []), r.get('source',''), r.get('quote','')))
    p=pats.get(r['id'])
    if p:
        conn.execute('INSERT OR REPLACE INTO formula_patterns (rule_id,title,cells,relations,source) VALUES (?,?,?,?,?)',
                     (r['id'], p.get('title',''), json.dumps(p.get('cells') or [], ensure_ascii=False),
                      json.dumps(p.get('relations') or [], ensure_ascii=False), p.get('source','')))

# 多对多：规则里的方名写法 → 方
unmatched={}
key_index={}
for nm,k in alias_index.items(): key_index.setdefault(name_key(nm), k)
for r in rules:
    for w in (r.get('formulas') or []):
        fid_=alias_index.get(w) or key_index.get(name_key(w))
        if fid_: alias_index.setdefault(w,fid_)
        conn.execute('INSERT OR REPLACE INTO rule_formulas (rule_id,formula_id,writing) VALUES (?,?,?)',
                     (r['id'], fid_, w))
        if not fid_: unmatched.setdefault(w,[]).append(r['id'])

conn.commit()

def q(sql):
    return conn.execute(sql).fetchone()[0]
print('→', DB)
for t in ['formulas','formula_aliases','formula_rules','rule_formulas','formula_patterns']:
    print(f'   {t:<18} {q(f"SELECT COUNT(*) FROM {t}")} 行')
print(f'   规则里的方名写法共 {q("SELECT COUNT(*) FROM rule_formulas")} 条，未解析 {sum(len(v) for v in unmatched.values())} 条')
if unmatched:
    print('   未解析的写法（保留 writing，formula_id 留空）：')
    for w,ids in sorted(unmatched.items())[:15]:
        print(f'     {w}  ← {len(ids)} 条规则')
conn.close()
