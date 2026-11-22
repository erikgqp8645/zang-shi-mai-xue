#!/usr/bin/env python3
'''
把 local-data/formulas.db（5 张表）导出成前端只读快照 src/content/formulas.json。

    python3 scripts/build-formula-db.py      # 先灌库
    python3 scripts/export-formulas-json.py  # 再出快照

为什么要出快照而不是让前端直连库：网页版是纯静态构建（Vite 打包时内联 JSON），
小程序也共用同一份；库是管理面，快照是运行面 —— 与内容层「库 → 快照」同一套做法。
'''
import json, sqlite3, collections

DB='local-data/formulas.db'
OUT='src/content/formulas.json'

c=sqlite3.connect(DB); c.row_factory=sqlite3.Row

aliases=collections.defaultdict(list)
for r in c.execute('SELECT formula_id, source, name FROM formula_aliases ORDER BY source, name'):
    aliases[r['formula_id']].append({'source': r['source'], 'name': r['name']})

rules_of=collections.defaultdict(list)
for r in c.execute('SELECT formula_id, rule_id FROM rule_formulas WHERE formula_id IS NOT NULL'):
    rules_of[r['formula_id']].append(r['rule_id'])

items=[]
for r in c.execute('SELECT * FROM formulas ORDER BY COALESCE(p42_no, 999), name'):
    items.append({
        'id': r['id'],
        'name': r['name'],
        'baseName': r['base_name'] or '',
        'qualifier': r['qualifier'] or '',
        'relation': r['relation'] or '',
        'p42No': r['p42_no'],
        'p42Indication': r['p42_indication'] or '',
        'doseId': r['dose_id'],
        'drugName': next((a['name'] for a in aliases.get(r['id'], []) if a['source'] == '讲稿 2010'), ''),
        'compositionTh': r['composition_th'] or '',
        'compositionDraft': r['composition_draft'] or '',
        'science': r['science'] or '',
        'usage': r['usage'] or '',
        'adjustments': r['adjustments'] or '',
        'contraindications': r['contraindications'] or '',
        'note': r['note'] or '',
        'aliases': aliases.get(r['id'], []),
        'ruleIds': rules_of.get(r['id'], []),
    })

doc={
  '$schema': './schema/formulas.schema.json',
  'note': '由 local-data/formulas.db 导出；原始资料仍是 src/content/*.json 与讲义原文，本文件是归一后的只读快照',
  'counts': {'formulas': len(items)},
  'formulas': items,
}
open(OUT,'w',encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, indent=1)+'\n')
print('→', OUT, len(items), '条')
print('   有 p42 行号:', sum(1 for x in items if x['p42No']))
print('   两套组成都有的:', sum(1 for x in items if x['compositionTh'] and x['compositionDraft']))
