"""Owned folder management. Removing a folder never removes vocabulary or SRS."""
from . import main as core

PRIVATE={'Cache-Control':'private, no-store'}

async def manage_folder(user,body):
    action=body.get('action')
    allowed={'action','folderId','name','newName'} if action=='rename' else {'action','folderId'}
    folder=core.uuid_value(body.get('folderId'))
    name=body.get('newName',body.get('name'))
    if 'newName' in body and 'name' in body and body['newName']!=body['name']:
        return core.j({'error':'invalid_input'},400,PRIVATE)
    if action not in ('rename','delete') or set(body)-allowed or not folder:
        return core.j({'error':'invalid_input'},400,PRIVATE)
    if action=='rename' and (not isinstance(name,str) or not 1<=len(name.strip())<=80):
        return core.j({'error':'invalid_input'},400,PRIVATE)
    db=await core.pool()
    try:
        async with db.acquire() as con:
            async with con.transaction():
                await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user['id'])
                current=await con.fetchrow('SELECT id,name FROM vocab_folders WHERE id=$1 AND user_id=$2 FOR UPDATE',folder,user['id'])
                if not current:return core.j({'error':'folder_not_found'},404,PRIVATE)
                if action=='rename':
                    name=name.strip()
                    duplicate=await con.fetchval('SELECT id FROM vocab_folders WHERE user_id=$1 AND name=$2 AND id<>$3',user['id'],name,folder)
                    if duplicate:return core.j({'error':'folder_exists'},409,PRIVATE)
                    row=await con.fetchrow('UPDATE vocab_folders SET name=$3 WHERE id=$1 AND user_id=$2 RETURNING id,name',folder,user['id'],name)
                    result={'ok':True,'folder':{'id':str(row['id']),'name':row['name']}}
                else:
                    await con.execute('UPDATE user_vocabulary SET folder_id=NULL WHERE user_id=$1 AND folder_id=$2',user['id'],folder)
                    await con.execute('DELETE FROM vocab_folders WHERE id=$1 AND user_id=$2',folder,user['id'])
                    result={'ok':True,'deletedFolderId':str(folder),'wordsPreserved':True}
        return core.j(result,headers=PRIVATE)
    except Exception as exc:
        if getattr(exc,'sqlstate',None)=='23505':return core.j({'error':'folder_exists'},409,PRIVATE)
        raise
