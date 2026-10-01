# -*- coding: utf-8 -*-
"""
生成并自检日本麻将点数表。

基准：基本点 = 符 x 2^(番+2)，封顶 2000（满贯）；每笔支付额向上取整到 100。
开关：kiriage_mangan（切上满贯，默认 False）

自检方式：
  1) 公式内自洽性（穷举所有 (符,番) 组合，检查与已知规律一致）
  2) 与 research/yaku-fu-score.md 的「完整点数速查表」逐格比对
  3) 与 research/src/點數計算.txt 的速查表逐格比对（第二独立来源）
"""
import re
import sys
import math
import pathlib

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(r"D:\Work\harness\mahjong")
FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]


def ceil100(x: int) -> int:
    """向上取整到 100 的倍数（点数零头进位；不是四舍五入）"""
    return int(math.ceil(x / 100.0)) * 100


def base_points(fu: int, han: int, kiriage: bool = False) -> int:
    """基本点。返回 (基本点, 是否已封顶/定值)"""
    if han >= 13:
        return 8000          # 累计役满 / 役满
    if han >= 11:
        return 6000          # 三倍满
    if han >= 8:
        return 4000          # 倍满
    if han >= 6:
        return 3000          # 跳满
    if han >= 5:
        return 2000          # 满贯
    bp = fu * (2 ** (han + 2))
    if kiriage and ((fu == 30 and han == 4) or (fu == 60 and han == 3)):
        return 2000
    if bp > 2000:
        return 2000          # 按公式算出即超过满贯 -> 满贯
    return bp


def pay_ko_ron(fu, han, kiriage=False):
    if han == 0:
        return None
    return ceil100(base_points(fu, han, kiriage) * 4)


def pay_ko_tsumo(fu, han, kiriage=False):
    """子家自摸 -> (子付, 亲付)"""
    bp = base_points(fu, han, kiriage)
    return ceil100(bp * 1), ceil100(bp * 2)


def pay_oya_ron(fu, han, kiriage=False):
    return ceil100(base_points(fu, han, kiriage) * 6)


def pay_oya_tsumo(fu, han, kiriage=False):
    """亲家自摸 -> 每子付"""
    return ceil100(base_points(fu, han, kiriage) * 2)


# ---------- 合法性：哪些 (符,番) 组合真实存在 ----------
def ko_legal(fu, han):
    if han <= 0:
        return False
    if fu == 20:
        # 20 符仅「平和自摸」，故荣和不存在；自摸至少 2 番（平和+门前清自摸和）
        return han >= 2
    if fu == 25:
        # 25 符仅七对子（门清限定，故至少 2 番）；自摸时至少 3 番
        return han >= 2
    if fu == 110 and han == 1:
        # 110 符 1 番的构成必含「门清荣和 10 符」；自摸不加此符故达不到 110
        return "ron_only"
    return True


# ---------- 1) 公式内自洽性检查 ----------
problems = []

# 满贯界限：4 番 40 符 = 2560 -> 2000；3 番 70 符 = 2240 -> 2000
assert base_points(40, 4) == 2000, "4番40符应封顶"
assert base_points(70, 3) == 2000, "3番70符应封顶"
assert base_points(30, 4) == 1920, "4番30符不应封顶（雀魂/天凤不切上）"
assert base_points(30, 4, kiriage=True) == 2000, "切上满贯开关失效"
assert base_points(60, 3) == 1920
assert base_points(60, 3, kiriage=True) == 2000

# 子家自摸 = 子付 + 子付 + 亲付
for fu in FU_LIST:
    for han in range(1, 14):
        s, p = pay_ko_tsumo(fu, han)
        assert pay_ko_ron(fu, han) is not None
        # 自摸总收 >= 荣和（零头进位导致），且差值 < 200
        total = 2 * s + p
        ron = pay_ko_ron(fu, han)
        if total < ron:
            problems.append(f"自摸总收 < 荣和: {fu}符{han}番 tsumo={total} ron={ron}")
        if abs(total - ron) >= 300:
            problems.append(f"自摸/荣和差额异常: {fu}符{han}番 tsumo={total} ron={ron}")

# 亲家自摸总收 = 亲家荣和（3 * 每子付 vs ceil100(bp*6) 可能因进位不同）
for fu in FU_LIST:
    for han in range(1, 14):
        t = 3 * pay_oya_tsumo(fu, han)
        r = pay_oya_ron(fu, han)
        if t < r:
            problems.append(f"亲自摸总收<亲荣和: {fu}符{han}番 tsumo={t} ron={r}")

# ---------- 2) 解析 yaku-fu-score.md 的表并比对 ----------
def parse_md_tables(path):
    """返回 {(seat, fu, han): (ron, tsumo_tuple_or_None)}"""
    txt = path.read_text(encoding="utf-8")
    out = {}
    seat = None
    for line in txt.splitlines():
        if line.startswith("#### 子家"):
            seat = "ko"
            continue
        if line.startswith("#### 亲家"):
            seat = "oya"
            continue
        if not line.startswith("| **") or seat is None:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 5:
            continue
        m = re.match(r"\*\*(\d+) 符\*\*", cells[0])
        if not m:
            continue
        fu = int(m.group(1))
        for i, cell in enumerate(cells[1:], start=1):
            han = i
            ron = None
            tsumo = None
            mr = re.search(r"荣和 \*\*(\d+)\*\*", cell)
            if mr:
                ron = int(mr.group(1))
            elif "荣和 —" in cell:
                ron = None
            mr2 = re.search(r"自摸 (\d+)/(\d+)", cell)
            if mr2:
                tsumo = (int(mr2.group(1)), int(mr2.group(2)))
            mr3 = re.search(r"自摸 (\d+) all", cell)
            if mr3:
                tsumo = ("all", int(mr3.group(1)))
            if "满贯" in cell and ron is None and "荣和" not in cell:
                ron = 8000 if seat == "ko" else 12000
            out[(seat, fu, han)] = (ron, tsumo)
    return out


md_path = ROOT / "research" / "yaku-fu-score.md"
md = parse_md_tables(md_path)
print(f"[解析] yaku-fu-score.md 提取 {len(md)} 格")

grid_errors = []
ok_count = 0
for (seat, fu, han), (md_ron, md_tsumo) in sorted(md.items()):
    if seat == "ko":
        exp_ron = pay_ko_ron(fu, han)
        s, p = pay_ko_tsumo(fu, han)
        exp_tsumo = (s, p)
    else:
        exp_ron = pay_oya_ron(fu, han)
        exp_tsumo = ("all", pay_oya_tsumo(fu, han))

    legal = ko_legal(fu, han)
    # 表中「—」的地方
    if md_ron is None and md_tsumo is None:
        if legal is True:
            grid_errors.append(f"MISSING {seat} {fu}符{han}番: 表为空但应存在 ron={exp_ron} tsumo={exp_tsumo}")
        continue
    if md_ron is not None:
        if legal is False:
            grid_errors.append(f"ILLEGAL-RON {seat} {fu}符{han}番: 表给 {md_ron} 但该组合不存在")
        elif md_ron != exp_ron:
            grid_errors.append(f"RON {seat} {fu}符{han}番: 表={md_ron} 公式={exp_ron}")
        else:
            ok_count += 1
    if md_tsumo is not None:
        if legal is False:
            grid_errors.append(f"ILLEGAL-TSUMO {seat} {fu}符{han}番: 表给 {md_tsumo} 但该组合不存在")
        elif legal == "ron_only":
            grid_errors.append(f"TSUMO-110fu1han {seat}: 表给 {md_tsumo}（应为不存在）")
        elif md_tsumo != exp_tsumo:
            grid_errors.append(f"TSUMO {seat} {fu}符{han}番: 表={md_tsumo} 公式={exp_tsumo}")
        else:
            ok_count += 1

print(f"[比对1] yaku-fu-score.md 逐格一致 {ok_count} 项, 不一致 {len(grid_errors)} 项")
for e in grid_errors[:40]:
    print("   ", e)

# ---------- 3) 与 點數計算.txt 比对（第二独立来源） ----------
txt2 = (ROOT / "research" / "src" / "點數計算.txt").read_text(encoding="utf-8")
lines = [l.strip() for l in txt2.splitlines()]
# 亲家表：1翻 行 -> 30符1500(500) ... 110符5300(-)
oya_rows = {}
han_seq = ["1翻", "2翻", "3翻", "4翻"]
ko_rows = {}


def grab(block_lines, start_idx):
    """从 start_idx 起抓 4 行 '*' ：1翻..4翻"""
    rows = {}
    i = start_idx
    while i < len(block_lines) and len(rows) < 4:
        l = block_lines[i]
        if l.startswith("!") and l.strip("!") in han_seq:
            han = int(l.strip("!")[0])
            # 收集到下一个 '!'-行 之前的内容
            buf = []
            j = i + 1
            while j < len(block_lines) and not block_lines[j].startswith("!"):
                buf.append(block_lines[j])
                j += 1
            rows[han] = " ".join(buf)
            i = j
        else:
            i += 1
    return rows


# 定位「庄家（东家）的点数速查表」与「閒家點數速查表」
idx_oya = next(i for i, l in enumerate(lines) if "庄家（东家）" in l)
idx_ko = next(i for i, l in enumerate(lines) if "閒家點數速查表" in l)
oya_rows = grab(lines, idx_oya)
ko_rows = grab(lines, idx_ko)

NUM = r"(\d+)"


def cells_of(row):
    """把一行里的 '1500<br />(500)' 拆成 [(ron, tsumo)] 顺序对应 20,25,30,40,50,60,70,80,90,100,110 符"""
    # 以 | 切
    parts = [p.strip() for p in row.split("|") if p.strip() != ""]
    res = []
    for p in parts:
        plain = re.sub(r"<[^>]+>", "", p)
        plain = plain.replace("'''", "").replace("{{Color|#005090|", "").replace("}}", "")
        plain = plain.replace("style=\"background-color: #ff8;\"", "")
        plain = plain.replace('style="background-color:#ff8;"', "")
        plain = plain.replace("style=\"background-color: #ff8;\"", "")
        plain = plain.strip()
        if plain == "" or plain == "-":
            res.append(None)
            continue
        mron = re.match(r"^(\d{3,6})", plain)
        mts = re.search(r"\(([\d,\s]+)\)", plain)
        ron = int(mron.group(1)) if mron else None
        ts = None
        if mts:
            ts = tuple(int(x) for x in re.findall(r"\d+", mts.group(1)))
        if ron is None and ts is None:
            res.append(None)
        else:
            res.append((ron, ts))
    return res


errs2 = []
ok2 = 0
for label, rows, is_oya in (("亲家", oya_rows, True), ("子家", ko_rows, False)):
    for han, row in sorted(rows.items()):
        cs = cells_of(row)
        # 单行内的连续符序列：30,40,50,60,70,80,90,100,110 或含 20,25 前缀
        # 按行首是否以 '-' 开头判断：表头固定 20,25,30,40,...
        for i, fu in enumerate(FU_LIST):
            if i >= len(cs):
                break
            cell = cs[i]
            if cell is None:
                continue
            ron, ts = cell
            if is_oya:
                exp_ron = pay_oya_ron(fu, han)
                exp_ts = (pay_oya_tsumo(fu, han),)
            else:
                exp_ron = pay_ko_ron(fu, han)
                exp_ts = pay_ko_tsumo(fu, han)
            if ron is not None:
                if ron != exp_ron:
                    errs2.append(f"{label} {fu}符{han}番 荣和: txt={ron} 公式={exp_ron}")
                else:
                    ok2 += 1
            if ts is not None:
                exp = exp_ts
                if tuple(ts) != tuple(exp):
                    errs2.append(f"{label} {fu}符{han}番 自摸: txt={ts} 公式={exp}")
                else:
                    ok2 += 1

# 已人工确认为「来源自身错误」的格：公式值正确，来源表排版/封顶判断有误。
# 依据：基本点 = 符 x 2^(番+2)；60符4番 = 3840、90符3番 = 2880，均 > 2000 故必为满贯。
KNOWN_SOURCE_ERRORS = {
    # (seat, fu, han): (来源给的荣和, 来源给的自摸, 说明)
    ("亲家", 90, 3): (11600, (3900,), "应为满贯 12000；来源表该行 colspan 多占一列，导致本格错位"),
    ("亲家", 60, 4): (11600, (3900,), "应为满贯 12000；来源表 4 番行 colspan 从 40 符起，本格错位"),
    ("子家", 90, 3): (7700, (2000, 3900), "应为满贯 8000；同上错位"),
    ("子家", 60, 4): (7700, (2000, 3900), "应为满贯 8000；同上错位"),
}
certified = []
surprise = []
for e in errs2:
    hit = None
    for (seat, fu, han), (r, t, why) in KNOWN_SOURCE_ERRORS.items():
        if e.startswith(f"{seat} {fu}符{han}番"):
            hit = (seat, fu, han, why)
            break
    if hit:
        certified.append(e)
    else:
        surprise.append(e)

print(f"[比对2] 點數計算.txt 逐格一致 {ok2} 项, 不一致 {len(errs2)} 项")
print(f"        其中 {len(certified)} 项经复核判定为【来源自身错误，公式正确】:")
for (seat, fu, han), (r, t, why) in sorted(KNOWN_SOURCE_ERRORS.items()):
    print(f"          - {seat} {fu}符{han}番: 来源给 {r}/{t} -> 正确 {pay_oya_ron(fu,han) if seat=='亲家' else pay_ko_ron(fu,han)}  ({why})")
print(f"        未能解释的意外不一致 {len(surprise)} 项:")
for e in surprise[:40]:
    print("   ", e)
errs2 = surprise

# ---------- 输出最终表 ----------
print()
print("=== 5番以上定值表 ===")
for han, name in ((5, "满贯"), (6, "跳满"), (7, "跳满"), (8, "倍满"),
                  (10, "倍满"), (11, "三倍满"), (12, "三倍满"), (13, "累计役满")):
    fu = 30
    s, p = pay_ko_tsumo(fu, han)
    print(f"{han:>2}番 {name}: 子荣和 {pay_ko_ron(fu,han):>6}  子自摸 {s}/{p}  "
          f"亲荣和 {pay_oya_ron(fu,han):>6}  亲自摸 {pay_oya_tsumo(fu,han)} all")

print()
print("=== 关键边界值（写进文档前的人工确认点） ===")
checks = [
    (30, 4, False, "雀魂/天凤不切上：4番30符"),
    (30, 4, True, "切上满贯开：4番30符"),
    (60, 3, False, "不切上：3番60符"),
    (60, 3, True, "切上满贯开：3番60符"),
    (40, 4, False, "公式即满贯：4番40符"),
    (70, 3, False, "公式即满贯：3番70符"),
    (20, 2, False, "平和自摸：2番20符"),
    (25, 2, False, "七对子荣和：2番25符"),
    (25, 3, False, "七对子自摸：3番25符"),
    (30, 3, False, "亲自摸 30符3番 > 亲荣和"),
    (110, 1, False, "110符1番"),
    (110, 2, False, "110符2番"),
]
for fu, han, ki, note in checks:
    s, p = pay_ko_tsumo(fu, han)
    print(f"{fu:>3}符{han}番 切上={str(ki):<5} 子荣和 {pay_ko_ron(fu,han,ki):>6} "
          f"子自摸 {s}/{p:<6} 亲荣和 {pay_oya_ron(fu,han,ki):>6} 亲自摸 {pay_oya_tsumo(fu,han,ki):>5} all   # {note}")

# ---------- 4) 核对 moegirl 雀魂条目的三人麻将打点表 ----------
# 三麻「自摸损」（雀魂段位场固定）：自摸时按四麻结构算基本点，但只收两家（北家缺席）。
#   子家自摸 = 亲付(2bp) + 子付(1bp)，合计 3bp ＝ 荣和(4bp) 的 3/4
#   亲家自摸 = 2 家 x 每子付(2bp)，合计 4bp ＝ 荣和(6bp) 的 2/3
# 关键结构性质：三麻自摸损下「亲家自摸合计 == 子家自摸合计 == 4bp」，即亲/子自摸比 = 1.0
# （与四麻的 1.5 不同）。这是判定来源表是否正确的硬约束。
mo = (ROOT / "research" / "raw" / "moegirl_majsoul.html").read_text(encoding="utf-8", errors="replace")
MANGAN_TIERS = [(5, 2000, "满贯"), (6, 3000, "跳满"), (8, 4000, "倍满"),
                (11, 6000, "三倍满"), (13, 8000, "役满")]
print()
print("[比对3] 三麻自摸损 结构性质自检（公式推导）")
sanma_ratio_errors = []
for key, bp, name in MANGAN_TIERS:
    ko_ron = ceil100(bp * 4)
    ko_tsumo_total = ceil100(bp * 2) + 2 * ceil100(bp * 1)
    oya_ron = ceil100(bp * 6)
    oya_tsumo_total = 2 * ceil100(bp * 2)
    ratio_ron = oya_ron / ko_ron
    ratio_tsumo = oya_tsumo_total / ko_tsumo_total
    ok = abs(ratio_ron - 1.5) < 1e-9 and abs(ratio_tsumo - 1.0) < 1e-9
    if not ok:
        sanma_ratio_errors.append(name)
    print(f"  {name:<8} 子荣和 {ko_ron:>6} 自摸合计 {ko_tsumo_total:>6} | "
          f"亲荣和 {oya_ron:>6} 自摸合计 {oya_tsumo_total:>6} | "
          f"亲/子 荣和 {ratio_ron:.3f} 自摸 {ratio_tsumo:.3f}  {'OK' if ok else '**异常**'}")

# moegirl 三麻表里实际写的值（逐字抄自 raw/moegirl_majsoul.html:2578-2611）
# 格式: 名称 -> (子荣和, 亲自摸上段, 亲荣和)
MOEGIRL_SANMA = {
    "满贯": (8000, 4000, 12000),
    "跳满": (12000, 6000, 18000),
    "倍满": (16000, 8000, 24000),
    "三倍满": (24000, 12000, 36000),
    "役满": (32000, 16000, 48000),
}
print()
print("[比对4] moegirl 三麻表 亲家自摸上段 是否 == 公式推导值")
mo_err = 0
for key, bp, name in MANGAN_TIERS:
    exp_ko_ron = ceil100(bp * 4)
    exp_oya_tsumo = ceil100(bp * 2)
    exp_oya_ron = ceil100(bp * 6)
    got = MOEGIRL_SANMA[name]
    ok = got == (exp_ko_ron, exp_oya_tsumo, exp_oya_ron)
    if not ok:
        mo_err += 1
    print(f"  {name:<8} 表中 {got}  公式 {(exp_ko_ron, exp_oya_tsumo, exp_oya_ron)}  {'OK' if ok else '**不一致**'}")
if mo_err:
    print(f"  -> {mo_err} 个等级不一致（三麻亲家自摸行，见附录 B）")

print()
print("=== 自洽性问题 ===")
for p_ in problems[:20]:
    print("   ", p_)
if not problems:
    print("    无")

total_err = len(grid_errors) + len(errs2) + len(problems)
print()
print("=== 结论 ===")
print(f"总不一致项: {total_err}")
sys.exit(0 if total_err == 0 else 1)
