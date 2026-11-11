#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""练习册 —— 自身的回归测试

用法::

    npm run test:e2e:exercise
    （Windows 上 `python3` 可能只是 Microsoft Store 的空壳别名 —— 用上面这条 npm 命令，
      仓库会自己找能用的解释器，不会卡在「python3 不是内部或外部命令」上）

## 测什么

练习册会**腐坏**：练习点位置漂移、期望值过期、验收脚本判错。
所以这里守住四件事：

① 练习点确实被**清空**了（没被谁填上）；
② **填对**后验收全过；
③ **填错**后验收必须失败（填符号代码而不是用字这种典型错法）；
④ 对练习册跑 ``content:json`` 会被**拒绝**（误操作防护），且真源一个字节都没动。

⭐ 第 ③ 条是「故意写坏」—— 断言必须先验证能抓到。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS = ROOT / "scripts"
CONTENT = ROOT / "src" / "content"

sys.path.insert(0, str(SCRIPTS))
from exercise_points import (  # noqa: E402
    EXERCISE_POINTS,
    expected_value,
    locate_cell,
    read_disk,
)

failures = 0
checks = 0


def ok(cond: bool, msg: str) -> None:
    global failures, checks
    checks += 1
    if cond:
        print(f"  ✓ {msg}")
    else:
        failures += 1
        print(f"  ✗ {msg}")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="pulse-exercise-"))
    try:
        print("① 生成练习册")
        wb_path = tmp / "示例-填写示范.xlsx"
        r = run([sys.executable, str(SCRIPTS / "make_exercise_workbook.py"), str(wb_path)])
        ok(r.returncode == 0, f"生成练习册不报错（退出码 {r.returncode}）")
        if r.returncode != 0:
            print(r.stderr)
            return 1
        ok(wb_path.exists(), "练习册已生成")

        disk = read_disk()
        wb = load_workbook(wb_path)

        print("② 练习点确实被清空")
        for p in EXERCISE_POINTS:
            row, col = locate_cell(wb, p)
            v = wb[p["where"]["sheet"]].cell(row=row, column=col).value
            ok(
                v is None or str(v).strip() == "",
                f"{p['id']} {p['title']} —— 是空的（现在 {v!r}）",
            )

        print("③ 填对 → 验收全过")
        wb = load_workbook(wb_path)
        for p in EXERCISE_POINTS:
            row, col = locate_cell(wb, p)
            wb[p["where"]["sheet"]].cell(row=row, column=col).value = expected_value(p, disk)
        filled = tmp / "filled.xlsx"
        wb.save(filled)
        r = run([sys.executable, str(SCRIPTS / "e2e" / "excel_exercise.py"), str(filled)])
        ok(r.returncode == 0, f"填对后验收通过（退出码 {r.returncode}）")
        if r.returncode != 0:
            print((r.stdout or "") + (r.stderr or ""))

        print("④ 填错 → 验收必须失败")
        p3 = next(p for p in EXERCISE_POINTS if p["id"] == "E3")
        wb = load_workbook(wb_path)
        row, col = locate_cell(wb, p3)
        # 典型错法：格子里填符号代码（`++`）而不是用字（`大`）
        wb[p3["where"]["sheet"]].cell(row=row, column=col).value = "++"
        wrong = tmp / "wrong.xlsx"
        wb.save(wrong)
        r = run([sys.executable, str(SCRIPTS / "e2e" / "excel_exercise.py"), str(wrong)])
        ok(r.returncode != 0, f"填错后验收失败（退出码 {r.returncode}）")
        out = (r.stdout or "") + (r.stderr or "")
        ok("E3" in out, "错误信息点名了 E3")

        print("⑤ 误操作防护：对练习册跑 content:json 必须被拒绝")
        before = {f.name: f.read_bytes() for f in sorted(CONTENT.glob("*.json"))}
        r = run([sys.executable, str(SCRIPTS / "excel_to_json.py"), str(wb_path)])
        ok(r.returncode != 0, f"对练习册还原被拒绝（退出码 {r.returncode}）")
        ok(
            "练习" in (r.stdout or "") + (r.stderr or ""),
            "错误信息说明了这是练习／示范工作簿",
        )
        after = {f.name: f.read_bytes() for f in sorted(CONTENT.glob("*.json"))}
        ok(before == after, "真源 JSON 一个字节都没变")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    if failures:
        print(f"[exercise-roundtrip] EXIT=1 —— {failures}/{checks} 项失败")
        return 1
    print(f"[exercise-roundtrip] EXIT=0 —— {checks} 项全过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
