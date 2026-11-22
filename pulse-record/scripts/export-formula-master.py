#!/usr/bin/env python3
"""
方剂主表导出（Excel）—— 按组成核对四套资料，一个规范方名一行。

用法：  cd pulse-record && python3 scripts/export-formula-master.py
产物：  exports/方剂主表-2026-11-21.xlsx（sheet 1 主表 / sheet 2 核对说明）

数据只读：src/content/doses.json（同和堂成方）、drugs.json（讲稿方剂）、
formula-reference.json（讲义 p42 原表）、formula-rules.json（讲义 p44 条目）。
不改任何数据文件，只产出一张核对用的表。

口径：去掉剂量与括注、只留药味；别名写法并成同味（枸杞子=枸杞、元参=玄参、
桂心=桂皮、芍药=白芍、炙甘草=甘草），再算 Jaccard。
"""
import json, re
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

BASE='src/content/'
doses = json.load(open(BASE+'doses.json', encoding='utf-8'))
drugs = json.load(open(BASE+'drugs.json', encoding='utf-8'))
ref   = json.load(open(BASE+'formula-reference.json', encoding='utf-8'))
rules = json.load(open(BASE+'formula-rules.json', encoding='utf-8'))['rules']

LOOSE={'枸杞子':'枸杞','元参':'玄参','桂心':'桂皮','术':'白术','芍药':'白芍','炙甘草':'甘草'}
UNITS={'克','g','G','片','钱','个','只','枚','两'}

def _tokens(comp, loose):
    if not comp: return set()
    s=re.sub(r'[（(][^）)]*[）)]','',comp)
    out=set()
    for p in re.split(r'[、，,;；\s+/＋+]+',s):
        p=p.strip()
        if not p: continue
        p=re.sub(r'[0-9０-９.．~\-－—]+','',p)          # 去数字
        p=re.sub(r'(克|g|G|片|钱|个|只|枚|两)$','',p)      # 去尾部单位
        p=p.strip('·．.')
        if not p or p in UNITS: continue
        out.add(LOOSE.get(p,p) if loose else p)
    return out

def herbs(comp): return _tokens(comp, True)
def herbs_strict(comp): return _tokens(comp, False)
def jac(a,b): return len(a&b)/len(a|b) if a and b else 0.0
def base(n): return re.sub(r'[（(].*?[）)]','',n).strip()

D={x['name']:x for x in doses['doses']}
DID={x['id']:x['name'] for x in doses['doses']}
G={x['name']:x for x in drugs['drugs']}
DH={n:herbs(v.get('composition')) for n,v in D.items()}
GH={n:herbs(v.get('composition')) for n,v in G.items()}
SCI=doses.get('scienceByDoseId',{})
alias=ref.get('alias',{})

rule_by_name={}
for r in rules:
    for f in (r.get('formulas') or []):
        rule_by_name.setdefault(f, []).append(r)

rows=[]; used_drug=set(); used_dose=set()

def rel_of(drug,dose,has_p42):
    if drug and dose:
        gs,ds=herbs_strict(G[drug].get('composition')), herbs_strict(D[dose].get('composition'))
        if gs and gs==ds: return '同一方·组成一致'
        if GH[drug] and GH[drug]==DH[dose]: return '同方·别名写法'
        j=jac(GH[drug],DH[dose])
        if j>=0.85: return '加减方'
        return '组成差异大（需核）'
    if dose and has_p42: return '仅同和堂有组成'
    if dose: return '仅同和堂'
    if drug: return '仅讲稿有组成'
    return '仅 p44 条目'

# ---- 1. p42 28 行（按登记的 doseId，不擅自改） ----
for r in ref['rows']:
    name=r['name']; dose=DID.get(r.get('doseId')); note=[]
    cand=alias.get(name); drug=None
    if cand and cand in G:
        j = jac(GH.get(cand,set()), DH.get(dose,set())) if dose else 0
        if not GH.get(cand) or j>=0.85: drug=cand
        else: note.append(f'讲稿侧参考条目「{cand}」，与同和堂这条的组成相似度仅 {j:.2f}，未并入')
    # 别名没有登记时，按组成找（≥0.85 才算同一方）
    if drug is None and dose and DH.get(dose):
        best=None
        for gname,hs in GH.items():
            if not hs or gname in used_drug: continue
            j=jac(hs,DH[dose])
            if best is None or j>best[0]: best=(j,gname)
        if best and best[0]>=0.85: drug=best[1]
    # 组成反向印证：这条成方是不是和讲稿别的方完全一致
    if dose:
        for gname,hs in GH.items():
            if hs and hs==DH[dose] and gname!=drug:
                note.append(f'组成与讲稿「{gname}」完全相同（同和堂版方名可能记成了别的方）')
    MANUAL={
      4: '注意：同和堂「五味异功（五异）」的组成是 8 味（含黄芪、葛根、干姜），不是经典五味异功散（5 味）；它与讲稿「右关虚脏·软而无力（加味理中）」一字不差 ⇒ p42 第 4 行与第 10 行在组成上可能互换，请人工确认',
      10: '同和堂「加味理中汤」的组成与讲稿三焦疗法的「中焦方」一致；讲稿五脏疗法那张「加味理中」的组成等于同和堂「五味异功（五异）」—— 这一组三处方名与组成需人工归一',
      16: '讲稿这条原名写「黄芪鳖甲／秦艽扶羸」，但组成是「肝肺同治 ＋ 青蒿」（与黄芪鳖甲那张 20 味的方不同）—— 名字与组成不符，已按组成并入本行',
    }
    if r['no'] in MANUAL: note.append(MANUAL[r['no']])
    rows.append(dict(canonical=name,p42no=r['no'],p42ind=r.get('indication',''),drug=drug,dose=dose,
                     note='；'.join(note),basis=r.get('doseBasis',''),kind='p42'))
    if drug: used_drug.add(drug)
    if dose: used_dose.add(dose)

# ---- 2. 剩下的讲稿方剂 ----
for gname,g in G.items():
    if gname in used_drug: continue
    best=None
    for dname in D:
        if dname in used_dose: continue
        j=jac(GH[gname],DH[dname])
        if best is None or j>best[0]: best=(j,dname)
    dname=None; note=[]
    if best and best[0]>=0.85: dname=best[1]
    else:
        # 已登记在别的行上的成方，组成接近也要指出来
        best_used=None
        for dn in D:
            j=jac(GH[gname],DH[dn])
            if DH[dn] and (best_used is None or j>best_used[0]): best_used=(j,dn)
        if best_used and best_used[0]>=0.85:
            note.append(f'组成与同和堂「{best_used[1]}」相似度 {best_used[0]:.2f}，但那条已登记在别的 p42 行，故本行不重复挂别名2')
    if (base(gname) or gname)=='中焦方':
        note.append('同和堂「加味理中汤」的组成与本条最接近（归尾／当归、生姜／干姜、柴葛等写法不同，Jaccard≈0.80），那条已登记在 p42 第 10 行')
    rows.append(dict(canonical=base(gname) or gname,p42no=None,p42ind='',drug=gname,dose=dname,
                     note='；'.join(note),basis='',kind='drug'))
    used_drug.add(gname)
    if dname: used_dose.add(dname)

# ---- 3. 剩下的成方 ----
for dname in D:
    if dname in used_dose: continue
    rows.append(dict(canonical=dname,p42no=None,p42ind='',drug=None,dose=dname,note='',basis='',kind='dose'))
    used_dose.add(dname)

# ---- 4. p44 独有方名 ----
known=set()
for x in rows:
    for n in (x['canonical'],x['drug'],x['dose']):
        if n: known|={n,base(n)}
for f in rule_by_name:
    if f in known or base(f) in known: continue
    rows.append(dict(canonical=f,p42no=None,p42ind='',drug=None,dose=None,note='',basis='',kind='rule'))

ORDER={'同一方·组成一致':0,'同方·别名写法':1,'加减方':2,'组成差异大（需核）':3,
       '仅同和堂有组成':4,'仅同和堂':5,'仅讲稿有组成':6,'仅 p44 条目':7}
rows.sort(key=lambda x:(0,x['p42no']) if x['p42no'] else (1, ORDER.get(rel_of(x['drug'],x['dose'],False),9), x['canonical']))

def p44_for(x):
    names={n for n in (x['canonical'],x['drug'],x['dose']) if n}
    names|={alias[n] for n in list(names) if n in alias}
    bases={base(n) for n in names}
    hits={}
    for f,rs in rule_by_name.items():
        if f in names or base(f) in bases:
            for r in rs: hits[r['id']]=r
    return list(hits.values())

wb=Workbook(); ws=wb.active; ws.title='方剂主表'
headers=['序号','规范名','别名1（讲稿 2010）','别名2（同和堂版）','p42 行号','p42 对应脉象及加减',
         'p44 命中（条）','p44 条目（条件 → 疗法）','讲稿组成（比例制）','成方组成（克）','科中比例',
         '关系','差异：仅讲稿有','差异：仅成方有','备注']
ws.append(headers)
SCI_BY_CODE={x.get('name'):x.get('ratio','') for x in doses.get('sciences',[]) if isinstance(x,dict)}
DID_BY_NAME={x['name']:x['id'] for x in doses['doses']}

thin=Side(style='thin',color='D9D2C2'); border=Border(left=thin,right=thin,top=thin,bottom=thin)
hdr_fill=PatternFill('solid',fgColor='E8E0CE')

for i,x in enumerate(rows,1):
    drug,dose=x['drug'],x['dose']
    rel=rel_of(drug,dose,bool(x['p42no']))
    dg,d_d=GH.get(drug,set()) if drug else set(), DH.get(dose,set()) if dose else set()
    only_g='、'.join(sorted(dg-d_d)) if drug and dose else ''
    only_d='、'.join(sorted(d_d-dg)) if drug and dose else ''
    notes=[n for n in (x['note'],x['basis']) if n]
    if rel=='组成差异大（需核）':
        notes.append(f'组成 Jaccard={jac(dg,d_d):.2f}')
    if x['kind']=='rule':
        notes.append('只在 p44 条目里出现（讲义图上的方名）')
        if '+' in x['canonical']:
            base_name=re.split(r'\s*[+＋]\s*', x['canonical'])[0].strip()
            hit = base_name if (base_name in known) else ''
            notes.append('组合方写法，照录原文，未展开' + (f'；基础方＝「{hit}」' if hit else ''))
    hits=p44_for(x)
    p44txt='；'.join(f"{h.get('condition','')} → {h.get('therapy','')}" for h in hits[:3])
    if len(hits)>3: p44txt+=f'（另 {len(hits)-3} 条）'
    sci=''
    if dose:
        did=DID_BY_NAME.get(dose)
        code=SCI.get(did) if isinstance(SCI,dict) else None
        sci=SCI_BY_CODE.get(code,'') if code else ''
    ws.append([i, x['canonical'],
               drug if drug and drug!=x['canonical'] else '',
               dose if dose and dose!=x['canonical'] else '',
               x['p42no'] or '', x['p42ind'], len(hits) or '', p44txt,
               G[drug].get('composition','') if drug else '',
               D[dose].get('composition','') if dose else '',
               sci, rel, only_g, only_d, '；'.join(notes)])

widths=[5,20,36,24,8,26,10,42,36,44,18,20,22,22,60]
for i,w in enumerate(widths,1): ws.column_dimensions[get_column_letter(i)].width=w
for c in ws[1]:
    c.font=Font(bold=True); c.fill=hdr_fill; c.border=border
    c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
ws.freeze_panes='C2'; ws.auto_filter.ref=f"A1:O{ws.max_row}"
for row in ws.iter_rows(min_row=2,max_row=ws.max_row):
    for c in row:
        c.border=border; c.alignment=Alignment(vertical='top',wrap_text=True)
ws.row_dimensions[1].height=34

ws2=wb.create_sheet('核对说明')
lines=[
 ['这份表怎么来的',''],
 ['数据来源','同和堂成方 doses.json（49 条，含科中 17 条）／讲稿 2010 方剂 drugs.json（30 条，26 条写了组成）／讲义 p42 原表 formula-reference.json（28 行）／讲义 p44 条目 formula-rules.json（61 条，只给方名）'],
 ['比对方法','组成去掉剂量与括注，只留药味；别名写法并成同味（枸杞子=枸杞、元参=玄参、桂心=桂皮、芍药=白芍、炙甘草=甘草），再算 Jaccard 相似度。'],
 ['关系怎么读','同一方·组成一致＝药味集合完全相同；同方·别名写法＝只差别名用字；加减方＝相似度≥0.85但有增删；组成差异大（需核）＝相似度<0.85；其余为单套独有。'],
 ['加味理中的坑','p42 第 10 行登记对照指向同和堂「加味理中汤」；但按组成核，讲稿五脏疗法那张「加味理中」（8 味）与同和堂「五味异功（五异）」完全相同，而「加味理中汤」的组成对应的是讲稿三焦疗法的「中焦方」。两条都在表里，备注已写明，请确认要不要改登记。'],
 ['肝肺同治','讲稿「左关右寸·浮大带点（黄芪鳖甲／秦羒扶羸）」的组成是「肝肺同治 ＋ 青蒿」，按组成并入肝肺同治这一行，差异列写明只差青蒿。'],
 ['差异两列','「仅讲稿有／仅成方有」＝两套组成逐味相减，只在两边都有组成时填。'],
 ['单位','讲稿是比例制、同和堂是克，本表并排显示，不换算、不合并。'],
 ['生成日期','2026-11-21'],
]
for r in lines: ws2.append(r)
ws2.column_dimensions['A'].width=18; ws2.column_dimensions['B'].width=110
for row in ws2.iter_rows():
    row[0].font=Font(bold=True)
    for c in row: c.alignment=Alignment(vertical='top',wrap_text=True)

out='exports/方剂主表-2026-11-21.xlsx'
wb.save(out)
from collections import Counter
print('saved', out, '行数', ws.max_row-1)
print(Counter(rel_of(x['drug'],x['dose'],bool(x['p42no'])) for x in rows))
