#!/usr/bin/env python3
"""Export reviewable Owner knowledge payloads. This never calls a live API."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/backend'))
from app import riwi_study_library as study


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,help='Write two original-note knowledge candidate payloads here')
    args=parser.parse_args()
    manifest={'version':study.VERSION,'lessons':len(study.library()),'externalAi':False,'sources':[]}
    for kind,title in study.SOURCE_TITLES.items():
        payload=study.installation_payload(kind)
        row={'kind':kind,'title':title,'checksum':study.source_checksum(kind),
             'units':len(study.source_records(kind)),'characters':len(payload['content']),
             'rightsClass':payload['rightsClass']}
        if args.output_dir:
            args.output_dir.mkdir(parents=True,exist_ok=True)
            target=args.output_dir/(kind+'-installation.json')
            target.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
            row['payloadFile']=str(target)
        manifest['sources'].append(row)
    print(json.dumps(manifest,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
