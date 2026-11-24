#!/usr/bin/env python3
"""
方剂主表导出（Excel）—— 按组成核对四套资料，一个规范方名一行。

用法：  cd pulse-record && python3 scripts/export-formula-master.py
产物：  exports/方剂主表-2026-11-21.xlsx（sheet 1 主表 / sheet 2 核对说明）

数据只读：src/content/doses.json（同和堂成方）、drugs.json（讲稿方剂）、
formula-reference.json（讲义 p42 原表）、formula-rules.json（讲义 p44 条目）。
不改任何数据文件，只产出一张核对用的表。

两张 sheet：
  方剂主表    —— 一个规范方名一行；含 p44 条目的条件／治法／出处／原文摘录
  疑似重复组  —— 按「名字归一」找出来的同方异写（组成无从比对时的兜底线索）

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

# 人工修订：用户在 Excel 里手改过的「保留哪些行 ＋ 改了哪些格子」
# （2026-11-23 他把 129 行裁到 81 行，并纠正了几处脉象／别名）
_CUR_PATH = BASE + 'formula-master-curation.json'
try:
    CURATION = json.load(open(_CUR_PATH, encoding='utf-8'))
except FileNotFoundError:
    CURATION = {'keep': [], 'overrides': {}}
KEEP = set(CURATION.get('keep') or [])
OVR = CURATION.get('overrides') or {}

def row_key(x):
    return f"{x['p42no'] if x['p42no'] else ''}|{x['canonical']}"
patterns = json.load(open(BASE+'pulse-patterns.json', encoding='utf-8'))['patterns']

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

def alias_cell(alias_name, canonical):
    """别名列只放**实质不同**的写法。

    只差数字写法（1号／一号）、方剂后缀（汤／散／丸）或括注的，不往别名列里重复一遍 ——
    那些在「疑似重复组」sheet 里已经单列了。用户 2026-11-23 指出这几行看着像重复。
    """
    if not alias_name or not canonical:
        return ''
    if alias_name == canonical:
        return ''
    if name_key(alias_name) == name_key(canonical):
        return ''
    return alias_name

def base(n): return re.sub(r'[（(].*?[）)]','',n).strip()

CN={'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10'}
def name_key(n):
    """名字归一 —— 去括注、中文数字转阿拉伯、去「汤散丸饮丹方」后缀；组合方单列。"""
    t=re.sub(r'[（(].*?[）)]','',n).replace('＋','+')
    combo='+' in t
    t=re.split(r'\s*\+\s*',t)[0]
    t=re.sub(r'([一二三四五六七八九十])号', lambda m: CN[m.group(1)]+'号', t)
    t=re.sub(r'\s+','',t)
    t=re.sub(r'(饮子|汤|散|丸|饮|丹|方)$','',t)
    return ('组合:' if combo else '')+t.strip()

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

def rel_of(drug,dose,has_p42,forced=None):
    if forced: return forced
    if drug and dose:
        gs,ds=herbs_strict(G[drug].get('composition')), herbs_strict(D[dose].get('composition'))
        if gs and gs==ds: return '同一方·组成一致'
        if GH[drug] and GH[drug]==DH[dose]: return '同方·别名写法'
        j=jac(GH[drug],DH[dose])
        if j>=0.85: return '加减方'
        return '组成差异大（需核）'
    if has_p42 and not dose and not drug: return '仅 p42 有方名（两套资料未载组成）'
    if dose and has_p42: return '仅同和堂有组成'
    if dose: return '仅同和堂'
    if drug: return '仅讲稿有组成'
    return '仅 p44 条目'

# ---- 1. p42 28 行（按登记的 doseId，不擅自改） ----
# ⚠️ 人工归一（按组成核对，优先于 alias／自动匹配）：
#    p42 第 10 行「加味理中」↔ 讲稿「右关虚脏·软而无力（加味理中）」↔ 同和堂「五味异功（五异）」（8 味一字不差）
#    p42 第 4 行「五味异功散」——同和堂没有它的独立组成（那条名为「五味异功」的其实是第 10 行的方），留空不硬套
#    同和堂「加味理中汤」= 讲稿三焦疗法的「中焦方」
MANUAL_P42 = {
  4: dict(
    dose=None, drug=None,
    note='同和堂版没有「五味异功散」的独立组成 —— 它那条名为「五味异功（五异）」的 8 味其实是 p42 第 10 行的加味理中。本行按经典五味异功散（四君子＋陈皮）处理，组成留空，不拿别的方顶替',
  ),
  10: dict(
    dose='五味异功（五异）', drug='右关虚脏 · 软而无力（加味理中）',
    note='按组成核对：讲稿「右关虚脏·软而无力（加味理中）」与同和堂「五味异功（五异）」8 味一字不差。同和堂的「加味理中汤」是**另一张方**（组成对应讲稿三焦疗法的「中焦方」），已挂到那一行',
  ),
}
MANUAL_DRUG = {
  '中焦方（加味理中）': dict(
    dose='加味理中汤', rel='加减方',
    note='同和堂「加味理中汤」的组成与本条一致（归尾／当归、生姜／干姜、柴葛等写法不同），按组成归到这里；p42 第 10 行的「加味理中」是另一张方（＝五味异功）',
  ),
}

for r in ref['rows']:
    name=r['name']; dose=DID.get(r.get('doseId')); note=[]
    cand=alias.get(name); drug=None
    m = MANUAL_P42.get(r['no'])
    if m:
        dose = m['dose']
        drug = m['drug']
        note = [m['note']]
        rows.append(dict(canonical=name,p42no=r['no'],p42ind=r.get('indication',''),drug=drug,dose=dose,
                         note='；'.join(note),basis=r.get('doseBasis',''),kind='p42'))
        if drug: used_drug.add(drug)
        if dose: used_dose.add(dose)
        continue
    if cand and cand in G:
        j = jac(GH.get(cand,set()), DH.get(dose,set())) if dose else 0
        same_name = name_key(cand)==name_key(dose) if dose else False
        if not GH.get(cand) or j>=0.85 or same_name: drug=cand
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
    if gname in MANUAL_DRUG:
        m = MANUAL_DRUG[gname]
        rows.append(dict(canonical=base(gname) or gname,p42no=None,p42ind='',drug=gname,dose=m['dose'],
                         note=m['note'],basis='',kind='drug',rel=m.get('rel')))
        used_drug.add(gname)
        if m['dose']: used_dose.add(m['dose'])
        continue
    # 先按名字同源挂（哪怕组成差得多 —— 那是「同方异写待核」，不是不同方）
    same=[d for d in D if name_key(d)==name_key(base(gname))]
    same.sort(key=lambda d: (d in used_dose, -jac(GH[gname],DH[d])))
    best=None
    for dname in D:
        if dname in used_dose: continue
        j=jac(GH[gname],DH[dname])
        if best is None or j>best[0]: best=(j,dname)
    dname=None; note=[]
    if same: dname=same[0]
    elif best and best[0]>=0.85: dname=best[1]
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

# ---- 合并：指向同一个成方（或同一张讲稿方剂）的多行，合成一行 ----
def merge_rows(rows):
    buckets={}
    order=[]
    for x in rows:
        k = ('dose:'+x['dose']) if x['dose'] else (('drug:'+x['drug']) if x['drug'] else 'row:'+x['canonical'])
        if k not in buckets:
            buckets[k]=dict(x); buckets[k]['_all']=[x]; order.append(k)
        else:
            b=buckets[k]; b['_all'].append(x)
            # 优先保留带 p42 行号的那条做规范名
            if x['p42no'] and not b['p42no']:
                keep={kk:vv for kk,vv in b.items() if not kk.startswith('_')}
                keep.update({kk:vv for kk,vv in x.items() if not kk.startswith('_')})
                keep['_all']=b['_all']; b.clear(); b.update(keep)
            if x['drug'] and not b['drug']: b['drug']=x['drug']
            if x['dose'] and not b['dose']: b['dose']=x['dose']
            if x['p42no'] and not b['p42no']: b['p42no']=x['p42no']; b['p42ind']=x['p42ind']
    out=[]
    for k in order:
        b=buckets[k]
        notes=[]
        for y in b['_all']:
            if y['note']: notes.append(y['note'])
            if y['basis']: notes.append(y['basis'])
        b['note']='；'.join(dict.fromkeys(notes))
        b.pop('_all',None)
        out.append(b)
    return out

rows=merge_rows(rows)

# 只保留人工修订里留下的行（没有修订文件时全留）
if KEEP:
    before_n = len(rows)
    rows = [x for x in rows if row_key(x) in KEEP]
    print(f'人工修订：{before_n} 行 → 保留 {len(rows)} 行')

ORDER={'同一方·组成一致':0,'同方·别名写法':1,'加减方':2,'组成差异大（需核）':3,
       '仅同和堂有组成':4,'仅同和堂':5,'仅讲稿有组成':6,'仅 p44 条目':7}
rows.sort(key=lambda x:(0,x['p42no']) if x['p42no'] else (1, ORDER.get(rel_of(x['drug'],x['dose'],False),9), x['canonical']))

def p44_for(x):
    """返回 [(规则, 命中的写法)] —— 命中的写法必须是原文里的方名写法，方便判断是不是同方异写。"""
    names={n for n in (x['canonical'],x['drug'],x['dose']) if n}
    names|={alias[n] for n in list(names) if n in alias}
    bases={base(n) for n in names}
    hits={}
    for f,rs in rule_by_name.items():
        bf=base(f)
        combo=any(bf==n or bf.startswith(n+' +') or bf.startswith(n+'＋') for n in bases)
        if f in names or bf in bases or combo:
            for r in rs:
                prev=hits.get(r['id'])
                if prev:
                    prev[1].add(f)
                else:
                    hits[r['id']]=(r,{f})
    return list(hits.values())

wb=Workbook(); ws=wb.active; ws.title='方剂主表'

# p42 第二列的拆分 —— **只拆原文，不改写、不补写**：
#   · 脉象：脉位＋脉象描述
#   · 症状：原文写明「治疗／用于」的是什么病
#   · 加减：原文写明的加减药
# 原文整串仍留在 `formula-reference.json` 的 indication 里（拆的是展示，不是数据）。
P42_SPLIT = {
  1:  ('变脉，六弱脉', '', ''),
  2:  ('变脉，六弱脉', '', ''),
  3:  ('变脉，任何一个脉有力', '', ''),
  4:  ('右关弱；右关浮大', '', '右关弱则拉高白术；右关浮大则拉高茯苓'),
  5:  ('右关弱', '慢性腹泻', ''),
  6:  ('右关浮软', '烧退又烧', ''),
  7:  ('右关浮大', '', ''),
  8:  ('右关浮大', '便秘', '加当归郁李仁'),
  9:  ('右三部脉浮洪大', '', ''),
  10: ('右关弱且左关有', '', ''),
  11: ('右关微', '伤寒感冒', ''),
  12: ('右关尺浮大顶手', '', ''),
  13: ('左寸弱迟', '', ''),
  14: ('左寸浮大数', '', ''),
  15: ('左寸关浮大', '', ''),
  16: ('左关右寸浮大', '', ''),
  17: ('双关右寸浮洪大', '', ''),
  18: ('左关洪或弦', '', ''),
  19: ('右寸浮洪大', '', ''),
  20: ('寸关浮大尺脉弱', '', ''),
  21: ('寸关浮大尺脉弱 且左关大', '', ''),
  22: ('左右尺脉不平衡；尺脉亢', '', ''),
  23: ('左右尺脉不平衡；尺脉亢；外加左关大', '', ''),
  24: ('变脉', '', ''),
  25: ('尺脉洪大', '', ''),
  26: ('', '食疗补肾方（一付五天）', ''),
  27: ('左右脉不平衡', '脱发、产后虚、大病初愈', ''),
  28: ('双关浮大', '虚人感冒', '加散药'),
}

headers=['规范名','别名1（讲稿 2010）','别名2（同和堂版）','讲义 p42 行号','脉象','症状','加减',
         'p44 命中（条）','路线','类别','五行','左右手','常驻条目','添加药','关联讲稿方剂 id','脉象图',
         'p44 条目（条件 → 疗法）','p44 治法','p44 出处','p44 原文摘录',
         '讲稿组成（比例制）','服法','加减','禁忌','成方组成（克）','科中比例',
         '关系','差异：仅讲稿有','差异：仅成方有','疑似重复（同组其它写法）','备注']
ws.append(headers)
SCI_BY_CODE={x.get('name'):x.get('ratio','') for x in doses.get('sciences',[]) if isinstance(x,dict)}
DID_BY_NAME={x['name']:x['id'] for x in doses['doses']}

# ---- 疑似重复：按名字归一，把同方异写聚在一起（组成比不了时的兜底线索）----
allnames=set()
for x in rows:
    for n in (x['canonical'],x['drug'],x['dose']):
        if n: allnames.add(n)
for f in rule_by_name: allnames.add(f)
dup_groups={}
for n in allnames: dup_groups.setdefault(name_key(n), set()).add(n)
dup_groups={k:v for k,v in dup_groups.items() if len(v)>1}
dup_of={}
for k,members in dup_groups.items():
    for m in members: dup_of[m]=k

def dup_others(x):
    names=[n for n in (x['canonical'],x['drug'],x['dose']) if n]
    keys={dup_of.get(n) for n in names}
    out=set()
    for k in keys:
        if not k: continue
        for m in dup_groups[k]:
            if m not in names: out.add(m)
    return '、'.join(sorted(out))

thin=Side(style='thin',color='D9D2C2'); border=Border(left=thin,right=thin,top=thin,bottom=thin)
hdr_fill=PatternFill('solid',fgColor='E8E0CE')

for i,x in enumerate(rows,1):
    drug,dose=x['drug'],x['dose']
    rel=rel_of(drug,dose,bool(x['p42no']), x.get('rel'))
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
    own={n for n in (x['canonical'],x['drug'],x['dose']) if n}
    def one(h):
        rule,writings=h
        extra=[w for w in sorted(writings) if w not in own]
        tail=f'〔原文写法：{"、".join(extra)}〕' if extra else ''
        return f"{rule.get('condition','')} → {rule.get('therapy','')}{tail}"
    p44txt='；'.join(one(h) for h in hits[:3])
    if len(hits)>3: p44txt+=f'（另 {len(hits)-3} 条）'
    sci=''
    if dose:
        did=DID_BY_NAME.get(dose)
        code=SCI.get(did) if isinstance(SCI,dict) else None
        sci=SCI_BY_CODE.get(code,'') if code else ''
    therapies='、'.join(dict.fromkeys(h[0].get('therapy','') for h in hits if h[0].get('therapy')))
    sources='；'.join(dict.fromkeys(h[0].get('source','') for h in hits if h[0].get('source')))
    quotes=' ｜ '.join(dict.fromkeys((h[0].get('quote','') or '').strip('「」')[:60] for h in hits if h[0].get('quote')))
    def agg(field):
        return '／'.join(dict.fromkeys(str(h[0].get(field,'')) for h in hits if h[0].get(field) not in (None,'')))
    kinds=agg('kind'); wux=agg('wuxing'); sides=agg('side')
    always='是' if any(h[0].get('always') for h in hits) else ''
    adds='；'.join(dict.fromkeys('、'.join(h[0].get('adds') or []) for h in hits if h[0].get('adds')))
    drug_ids='；'.join(dict.fromkeys('、'.join(h[0].get('drugs') or []) for h in hits if h[0].get('drugs')))
    pats=[]
    for h in hits:
        pid=h[0].get('id'); pat=patterns.get(pid)
        pats.append(f"{pat.get('title','有图')}（{len(pat.get('cells') or [])} 格）" if pat else '无图')
    pattern_txt='；'.join(dict.fromkeys(pats)) if pats else ''
    _vals = [x['canonical'],
               alias_cell(drug, x['canonical']),
               alias_cell(dose, x['canonical']),
               x['p42no'] or '',
               (P42_SPLIT.get(x['p42no'], (x['p42ind'], '', ''))[0] if x['p42no'] else ''),
               (P42_SPLIT.get(x['p42no'], ('', '', ''))[1] if x['p42no'] else ''),
               (P42_SPLIT.get(x['p42no'], ('', '', ''))[2] if x['p42no'] else ''),
               len(hits) or '',
               agg('route'), kinds, wux, sides, always, adds, drug_ids, pattern_txt,
               p44txt, therapies, sources, quotes,
               G[drug].get('composition','') if drug else '',
               G[drug].get('usage','') if drug else '',
               '；'.join(G[drug].get('adjustments') or []) if drug else '',
               G[drug].get('contraindication','') if drug else '',
               D[dose].get('composition','') if dose else '',
               sci, rel, only_g, only_d, dup_others(x), '；'.join(notes)]

    # 人工修订优先（用户手改过的格子，原样盖回去）
    for _col, _v in (OVR.get(row_key(x)) or {}).items():
        if _col in headers:
            _vals[headers.index(_col)] = _v or None
    ws.append(_vals)

widths=[20,36,24,13,26,20,24,10,20,12,10,14,10,26,26,30,42,28,40,46,36,26,34,34,44,18,20,22,22,34,60]
for i,w in enumerate(widths,1): ws.column_dimensions[get_column_letter(i)].width=w
for c in ws[1]:
    c.font=Font(bold=True); c.fill=hdr_fill; c.border=border
    c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
ws.freeze_panes='B2'; ws.auto_filter.ref=f"A1:AE{ws.max_row}"
for row in ws.iter_rows(min_row=2,max_row=ws.max_row):
    for c in row:
        c.border=border; c.alignment=Alignment(vertical='top',wrap_text=True)
    # 「讲义 p42 行号」居中：右对齐会贴着「脉象」那一列，看着像连在一起
    row[3].alignment=Alignment(horizontal='center', vertical='top')
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
 ['别名两列','只放**实质不同**的写法。只差数字写法（1号／一号）、方剂后缀（汤／散／丸）或括注的不再重复列 —— 那些在「疑似重复组」sheet 里单列。'],
 ['脉象／症状／加减','讲义 p42 第二列原文是一整句（如「右关弱；治疗慢性腹泻」），表里拆成三列方便筛：脉象＝脉位＋脉象，症状＝原文写明治疗什么病，加减＝原文写明的加减药。**只拆原文，不改写、不补写**；整串仍存在 formula-reference.json 的 indication 里。'],
 ['单位','讲稿是比例制、同和堂是克，本表并排显示，不换算、不合并。'],
 ['生成日期','2026-11-21'],
]
for r in lines: ws2.append(r)
ws2.column_dimensions['A'].width=18; ws2.column_dimensions['B'].width=110
for row in ws2.iter_rows():
    row[0].font=Font(bold=True)
    for c in row: c.alignment=Alignment(vertical='top',wrap_text=True)

# ---- sheet: 疑似重复组 ----
ws3=wb.create_sheet('疑似重复组')
ws3.append(['组号','归一写法','成员写法','成员数','类型','组内是否已有组成印证','说明'])
def kind_of(key,members):
    if key.startswith('组合:'): return '组合方（同一基础方的不同加味）'
    if any('（' in m or '(' in m for m in members): return '带括注的同方异写'
    if any(re.search(r'[一二三四五六七八九十]号',m) for m in members) and any(re.search(r'[0-9]号',m) for m in members):
        return '中文数字／阿拉伯数字写法'
    return '疑似同方异写'
def evidence(members, rows_):
    hit=[x for x in rows_ if (x['canonical'] in members or x['drug'] in members or x['dose'] in members) and x['drug'] and x['dose']]
    if not hit: return '无（缺组成，只按名字归一）'
    return '；'.join(f"{x['canonical']}：{rel_of(x['drug'],x['dose'],bool(x['p42no']))}" for x in hit[:3])
for gi,(k,members) in enumerate(sorted(dup_groups.items(), key=lambda t:-len(t[1])),1):
    ws3.append([gi, k, ' / '.join(sorted(members)), len(members), kind_of(k,members), evidence(members, rows), ''])
for i,w in enumerate([6,18,60,8,30,34,20],1):
    ws3.column_dimensions[get_column_letter(i)].width=w
for row in ws3.iter_rows():
    for c in row: c.border=border; c.alignment=Alignment(vertical='top',wrap_text=True)
for c in ws3[1]:
    c.font=Font(bold=True); c.fill=hdr_fill
ws3.freeze_panes='A2'

# ---- sheet: 规则明细（一条规则一行，界面上的字段一个不丢）----
ws4=wb.create_sheet('规则明细')
ws4.append(['序号','条目 id','路线','脉象（条件）','治法','类别','五行','左右手','常驻条目','知识库显示',
            '方名（原文写法）','添加药','关联讲稿方剂 id','出处','原文','脉象图','图名（格子数）'])
for i,r in enumerate(sorted(rules, key=lambda x:(x.get('route',''), x.get('id',''))),1):
    pat=patterns.get(r.get('id'))
    ws4.append([
        i, r.get('id',''), r.get('route',''), r.get('condition',''), r.get('therapy',''),
        r.get('kind',''), r.get('wuxing',''), r.get('side',''),
        '是' if r.get('always') else '', '是' if r.get('visible') else '否',
        '、'.join(r.get('formulas') or []),
        '、'.join(r.get('adds') or []),
        '、'.join(r.get('drugs') or []),
        r.get('source',''), (r.get('quote','') or '').strip('「」'),
        '有图' if pat else '无图',
        f"{pat.get('title','')}（{len(pat.get('cells') or [])} 格）" if pat else '',
    ])
for i,w in enumerate([5,26,22,26,40,10,8,12,10,10,34,20,32,44,80,8,30],1):
    ws4.column_dimensions[get_column_letter(i)].width=w
for row in ws4.iter_rows():
    for c in row: c.border=border; c.alignment=Alignment(vertical='top',wrap_text=True)
for c in ws4[1]:
    c.font=Font(bold=True); c.fill=hdr_fill
ws4.freeze_panes='C2'; ws4.auto_filter.ref=f"A1:Q{ws4.max_row}"

out='exports/方剂主表-2026-11-21.xlsx'
wb.save(out)
from collections import Counter
print('saved', out, '行数', ws.max_row-1)
print(Counter(rel_of(x['drug'],x['dose'],bool(x['p42no'])) for x in rows))
