"""Single-process Python application launcher. Node is used only for asset builds."""
import argparse
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def load_environment():
    """Load literal dotenv values without executing a shell or expanding secrets."""
    original = set(os.environ)
    mode = os.environ.get('APP_ENV',os.environ.get('NODE_ENV','development'))
    for name in ('.env',f'.env.{mode}','.env.local',f'.env.{mode}.local'):
        file = ROOT/name
        if not file.is_file(): continue
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            match = re.fullmatch(r'(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)',line)
            if not match: continue
            key,value = match.groups()
            if key in original: continue
            if value.startswith(('"',"'")):
                quote = value[0]
                if len(value)<2 or not value.endswith(quote):
                    raise ValueError(f'{name}: multiline or unmatched dotenv quote; set {key} in the host environment')
                value = value[1:-1]
                if quote=='"': value=value.replace('\\n','\n').replace('\\r','\r').replace('\\"','"')
            else:
                value = re.split(r'\s+#',value,maxsplit=1)[0].rstrip()
            os.environ[key] = value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reload',action='store_true')
    parser.add_argument('--check',action='store_true')
    args = parser.parse_args()
    load_environment()
    python = Path(os.environ.get('BACKEND_PYTHON',ROOT/'services/backend/.venv/bin/python'))
    if not python.is_absolute(): python=ROOT/python
    if python.exists() and Path(sys.executable).absolute()!=python.absolute():
        os.execv(str(python),[str(python),__file__,*sys.argv[1:]])
    sys.path.insert(0,str(ROOT/'services/backend'))
    from app.frontend_static import StaticFrontend
    if not StaticFrontend().build():
        raise SystemExit('Static frontend missing. Run npm run build first.')
    if args.check:
        import app.asgi,asyncpg,bcrypt,reportlab,docx,jwt
        print('Python ASGI + allowlisted static frontend ready; no Node server required')
        return
    import uvicorn
    os.environ.setdefault('STORAGE_LOCAL_DIR',str(ROOT/'.data/uploads'))
    uvicorn.run('app.asgi:application',app_dir=str(ROOT/'services/backend'),host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','8000')),reload=args.reload,access_log=False,proxy_headers=False,server_header=False)


if __name__=='__main__': main()
