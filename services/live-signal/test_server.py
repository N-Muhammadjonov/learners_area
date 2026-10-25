"""Exercise the same browser WebSocket protocol through the ASGI transport."""
import importlib.util
from pathlib import Path
import time
import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
spec=importlib.util.spec_from_file_location('live_signal_server',Path(__file__).with_name('server.py'))
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
SECRET='test-secret-'*4
ORIGIN='https://learner.test'

def token(user='alice',peer='bob',sid='session',**claims):
    return jwt.encode({'aud':server.AUDIENCE,'iss':server.ISSUER,'sub':user,'peer':peer,'sid':sid,'role':'offerer','exp':time.time()+120,**claims},SECRET,algorithm='HS256')

def client():return TestClient(server.create_app(secret=SECRET,allowed_origins=[ORIGIN]))

def test_relay_pair_privacy_and_room_cleanup():
    with client() as c:
        with c.websocket_connect('/signal',headers={'origin':ORIGIN}) as a:
            a.send_json({'type':'auth','token':token()});assert a.receive_json()=={'type':'ready','role':'offerer','peerPresent':False}
            with c.websocket_connect('/signal',headers={'origin':ORIGIN}) as b:
                b.send_json({'type':'auth','token':token('bob','alice',role='answerer')});assert b.receive_json()['peerPresent'];assert a.receive_json()=={'type':'peer-joined'}
                a.send_json({'type':'signal','kind':'offer','data':{'sdp':'offer'}});assert b.receive_json()=={'type':'signal','kind':'offer','data':{'sdp':'offer'}}
                a.send_json({'type':'signal','kind':'candidate','data':{'candidate':'candidate: host typ host'}});assert a.receive_json()['reason']=='non_relay_candidate_dropped'
                a.send_json({'type':'signal','kind':'candidate','data':None});assert b.receive_json()['data'] is None
            assert a.receive_json()=={'type':'peer-left'}
        assert c.get('/healthz').json()['rooms']==0

@pytest.mark.parametrize('claims',[{'exp':0},{'aud':'wrong'},{'iss':'wrong'},{'peer':'alice'}])
def test_reject_invalid_claims(claims):
    with client() as c,c.websocket_connect('/signal',headers={'origin':ORIGIN}) as ws:
        ws.send_json({'type':'auth','token':token(**claims)});assert ws.receive_json()['type']=='error'
        with pytest.raises(WebSocketDisconnect) as exc:ws.receive_json()
        assert exc.value.code==4401

def test_third_participant_denied_and_reconnect_replaces_old_socket():
    with client() as c,c.websocket_connect('/signal',headers={'origin':ORIGIN}) as a:
        a.send_json({'type':'auth','token':token()});a.receive_json()
        with c.websocket_connect('/signal',headers={'origin':ORIGIN}) as third:
            third.send_json({'type':'auth','token':token('charlie','alice')});assert third.receive_json()['reason']=='not_participant'
        with c.websocket_connect('/signal',headers={'origin':ORIGIN}) as replacement:
            replacement.send_json({'type':'auth','token':token()});assert replacement.receive_json()['type']=='ready'
            with pytest.raises(WebSocketDisconnect) as exc:a.receive_json()
            assert exc.value.code==4000
            replacement.send_json({'type':'ping'});assert replacement.receive_json()=={'type':'pong'}

def test_origin_auth_order_message_limit_and_flood():
    with client() as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect('/signal',headers={'origin':'https://evil.test'}):pass
        with c.websocket_connect('/signal',headers={'origin':ORIGIN}) as ws:
            ws.send_json({'type':'ping'});assert ws.receive_json()['reason']=='auth_required'
        with c.websocket_connect('/signal',headers={'origin':ORIGIN}) as ws:
            ws.send_text('x'*(server.MAX_MESSAGE+1))
            with pytest.raises(WebSocketDisconnect) as exc:ws.receive_json()
            assert exc.value.code==1009
    app=server.create_app(secret=SECRET,allowed_origins=[ORIGIN],now=lambda:time.time()//1000)
    with TestClient(app) as c,c.websocket_connect('/signal',headers={'origin':ORIGIN}) as ws:
        ws.send_json({'type':'auth','token':token()});ws.receive_json()
        for _ in range(60):ws.send_json({'type':'ping'});assert ws.receive_json()['type']=='pong'
        ws.send_json({'type':'ping'});assert ws.receive_json()['reason']=='rate_limited'
