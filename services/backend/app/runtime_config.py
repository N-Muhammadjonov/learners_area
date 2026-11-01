"""Portable deployment mode; managed deployments never inherit dev privileges."""
import os


def environment():
    configured=os.getenv('APP_ENV','').strip().lower()
    if configured and configured not in ('development','test','preview','production'):
        raise RuntimeError('APP_ENV must be development, test, preview or production')
    vercel=os.getenv('VERCEL_ENV','').strip().lower()
    if vercel and vercel not in ('development','preview','production'):
        raise RuntimeError('VERCEL_ENV must be development, preview or production')
    railway=os.getenv('RAILWAY_ENVIRONMENT_NAME','').strip().lower()
    if vercel=='production' or railway=='production':return 'production'
    if vercel=='preview' or railway and railway not in ('development','test'):return 'preview'
    return configured or 'development'


def development():
    return environment() in ('development','test')
