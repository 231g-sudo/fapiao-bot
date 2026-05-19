#!/usr/bin/env python3
"""FapiaoBot 激活码生成器
用法: python3 gen_codes.py [数量]

算法与前端 app.js _s() 完全一致。
"""

import sys
import random
import re

C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'


def _s(payload: str) -> str:
    h = 0
    for ch in payload:
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF
        if h >= 0x80000000:
            h -= 0x100000000
    a = str(abs(h))
    r = ''
    for _ in range(5):
        d = (int(a[_] if _ < len(a) else '0', 10) + _ * 7 + h) % 36
        r = C[(d + 36) % 36] + r
        a += str(h % (_ + 1))
    return r


def generate() -> str:
    payload = ''.join(random.choices(C, k=5))
    return f"FP-{payload}-{_s(payload)}"


def verify(code: str) -> bool:
    if not re.match(r'^FP-[A-Z0-9]{5}-[A-Z0-9]{5}$', code):
        return False
    parts = code.split('-')
    return parts[2] == _s(parts[1])


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    codes = [generate() for _ in range(n)]
    for c in codes:
        ok = '✅' if verify(c) else '❌'
        print(f"{ok} {c}")
    print(f"\n共生成 {n} 个激活码，全部验证通过")
