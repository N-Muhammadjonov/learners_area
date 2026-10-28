"""Activate due reading versions for native browser reads."""

async def activate_reading_schedules(con):
    from .step31_version_publication import publish
    while True:
        async with con.transaction():
            candidates = await con.fetch("""SELECT v.id,v.source_ref,v.content_type,v.version_no
                FROM content_versions v WHERE v.module='reading' AND v.publication_state='scheduled' AND (
                EXISTS(SELECT 1 FROM general_reading_sets s WHERE s.id=v.target_id AND s.publish_at<=NOW()) OR
                EXISTS(SELECT 1 FROM reading_passages p WHERE p.id=v.target_id AND p.publish_at<=NOW()))
                ORDER BY v.source_ref,v.content_type,v.version_no DESC,v.id LIMIT 100""")
            for candidate in candidates:
                await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))', 'reading-version:' + candidate['source_ref'])
                row = await con.fetchrow('SELECT * FROM content_versions WHERE id=$1', candidate['id'])
                if not row or row['publication_state'] != 'scheduled':
                    continue
                newer = await con.fetchval("""SELECT id FROM content_versions WHERE module='reading'
                    AND content_type=$1 AND source_ref=$2 AND status='published' AND version_no>$3 LIMIT 1""",
                    row['content_type'], row['source_ref'], row['version_no'])
                await publish(con, dict(row), 'archived' if newer else 'published', None,
                              {'role': 'system'}, system_schedule=True)
        if len(candidates) < 100:
            return
