#!/usr/bin/env python3
"""Validate the exact original reference PNG and quantify a rendered screenshot.
Run: python3 verify_reference.py [--candidate screenshot.png]
Dependencies for image comparison: Pillow (pip install pillow).
"""
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path

EXPECTED_SHA256 = "944835e4caca7c5915bc914d5cd4b0157837811aa1928e6f250f82cb39c65454"
EXPECTED_SIZE = 2762847
EXPECTED_DIMS = (1678, 937)
REGIONS = {
  "topbar": (0, 0, 1678, 85),
  "reading": (720, 72, 947, 292),
  "listening": (471, 128, 684, 322),
  "writing": (296, 259, 508, 439),
  "speaking": (216, 393, 448, 590),
  "grammar": (421, 523, 704, 755),
  "vocabulary": (729, 607, 977, 840),
  "progress": (1064, 558, 1339, 761),
  "mock_tests": (1303, 452, 1530, 655),
  "assignments": (1092, 345, 1370, 555),
  "live_classes": (1255, 233, 1481, 418),
  "ted_podcast": (980, 123, 1215, 359),
  "dashboard": (671, 353, 977, 555),
  "street_neon": (459, 289, 1394, 800),
  "platform_edges": (0, 459, 1678, 868),
  "utility": (1540, 784, 1668, 924),
}
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--reference', type=Path, default=Path(__file__).with_name('learners_area_reference.png'))
    ap.add_argument('--candidate', type=Path)
    ap.add_argument('--report', type=Path, default=Path('reference-comparison.json'))
    args=ap.parse_args()
    if not args.reference.is_file():
        print('MISSING original reference PNG:', args.reference, file=sys.stderr)
        return 2
    data=args.reference.read_bytes()
    digest=hashlib.sha256(data).hexdigest()
    print('Reference bytes:',len(data),'SHA-256:',digest)
    if digest != EXPECTED_SHA256 or len(data) != EXPECTED_SIZE:
        print('FAIL: Original reference binary differs.',file=sys.stderr)
        return 3
    print('PASS: reference is EXACTLY the uploaded PNG (byte-for-byte).')
    if not args.candidate:
        return 0
    from PIL import Image, ImageChops, ImageStat, ImageEnhance
    with Image.open(args.reference) as ri, Image.open(args.candidate) as ci:
        print('Reference dimensions:',ri.size,'Candidate dimensions:',ci.size)
        if ri.size != EXPECTED_DIMS or ci.size != EXPECTED_DIMS:
            print('FAIL: render dimensions must be 1678×937 (no upscaling).',file=sys.stderr)
            return 4
        ref=ri.convert('RGBA');cand=ci.convert('RGBA')
        result={'reference_sha256':digest,'candidate_sha256':hashlib.sha256(args.candidate.read_bytes()).hexdigest(),
          'width':1678,'height':937,'regions':{}}
        for name,box in {'whole_frame':(0,0,1678,937),**REGIONS}.items():
            a=ref.crop(box).convert('RGB')
            b=cand.crop(box).convert('RGB')
            diff=ImageChops.difference(a,b)
            stats=ImageStat.Stat(diff)
            mae=sum(stats.mean)/3
            extrema=diff.getbbox()
            result['regions'][name]={'mae_rgb':round(mae,4),'exact_match':extrema is None,'box':box}
        args.report.write_text(json.dumps(result,indent=2),encoding='utf-8')
        diff=ImageChops.difference(ref.convert('RGB'),cand.convert('RGB'))
        ImageEnhance.Contrast(diff).enhance(3).save(args.report.with_name('reference-difference.png'))
        print('Whole-frame MAE:',result['regions']['whole_frame']['mae_rgb'])
        print('Exact pixel equality:',result['regions']['whole_frame']['exact_match'])
        print('Reports:',args.report,'reference-difference.png')
    return 0
if __name__=='__main__': raise SystemExit(main())
