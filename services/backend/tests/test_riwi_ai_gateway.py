"""Bounded transport tests use synthetic responses and never call a provider."""
import asyncio
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock,patch

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
from app import riwi_ai_gateway as gateway
from app.riwi_provider_router import (PROVIDER_MAP,provider_readiness_snapshot,
    valid_provider_model,validate_provider_endpoint,RiwiProviderRouterError,
    dispatch_external_riwi_provider)
from app.riwi_provider_transport import create_riwi_transport
from app.riwi_capabilities import RiwiActor

ENV={"AI_GATEWAY_MODEL":"openai/gpt-4.1-mini","VERCEL_OIDC_TOKEN":"synthetic-token"}
ANSWER={"answer":"Use a before a consonant sound.","uncertainty":None,"citations":[]}

def response(content=None,finish="stop",usage=None):
    return {"choices":[{"finish_reason":finish,"message":{"content":json.dumps(ANSWER) if content is None else content}}],
            "usage":{"prompt_tokens":42,"completion_tokens":18} if usage is None else usage}

class GatewayTransportTest(unittest.TestCase):
    def test_oidc_and_api_key_alternatives_and_readiness_are_honest(self):
        for token_name in ("VERCEL_OIDC_TOKEN","AI_GATEWAY_API_KEY"):
            with self.subTest(auth=token_name):
                env={"AI_GATEWAY_MODEL":ENV["AI_GATEWAY_MODEL"],token_name:"synthetic-token"}
                self.assertEqual(gateway.missing_configuration(env),[])
                info=gateway.readiness(env)
                self.assertEqual(info["authentication"],token_name)
                self.assertFalse(info["liveVerified"])
                self.assertFalse(info["parameterTrainingPerformed"])
                self.assertNotIn("synthetic-token",json.dumps(info))
                status=next(x for x in provider_readiness_snapshot(env) if x["id"]=="vercel")
                self.assertTrue(status["secretsPresent"])
                self.assertEqual(status["model"],ENV["AI_GATEWAY_MODEL"])
        self.assertEqual(len(gateway.missing_configuration({})),2)
        self.assertIn("AI_GATEWAY_MODEL",gateway.missing_configuration({"VERCEL_OIDC_TOKEN":"synthetic-token"}))
        self.assertIn("AI_GATEWAY_MODEL",gateway.missing_configuration({**ENV,"AI_GATEWAY_MODEL":"bad-model"}))

    def test_gateway_credentials_cannot_be_submitted_as_learning_text(self):
        from app.riwi_outbound_guard import guard_external_payload,redact_external_text
        for name in ("AI_GATEWAY_API_KEY","VERCEL_OIDC_TOKEN"):
            text=name+"=synthetic-test-secret"
            with self.subTest(name=name):
                self.assertFalse(guard_external_payload("chat",{"message":text}) .ok)
                self.assertNotIn("synthetic-test-secret",redact_external_text(text))

    def test_model_paths_and_endpoint_are_restricted(self):
        self.assertTrue(valid_provider_model("vercel","openai/gpt-4.1-mini"))
        self.assertFalse(valid_provider_model("openai","openai/gpt-4.1-mini"))
        for model in ("openai/../../admin","https://evil.test/a","openai/gpt?key=x","openai/gpt#x","a/b/c","openai/"):
            with self.subTest(model=model):self.assertFalse(valid_provider_model("vercel",model))
        self.assertEqual(validate_provider_endpoint("vercel",gateway.URL),gateway.URL)
        for url in ("https://evil.test/v1","http://ai-gateway.vercel.sh/v1","https://127.0.0.1/v1"):
            with self.subTest(url=url),self.assertRaises(RiwiProviderRouterError):
                validate_provider_endpoint("vercel",url)

    def test_bounded_request_uses_shared_actor_admission_and_server_contract(self):
        async def run():
            request=AsyncMock(return_value=response())
            with patch.dict(os.environ,ENV,clear=True),patch("app.ai_runtime.request_json",request):
                result=await create_riwi_transport("actor-id")("vercel",ENV["AI_GATEWAY_MODEL"],
                    {"instructions":"Trusted server contract: return JSON.","language":"en","message":"Teach articles."})
            self.assertEqual(result["answer"],ANSWER)
            self.assertEqual(result["usage"],{"inputTokens":42,"outputTokens":18})
            args=request.await_args
            self.assertEqual(args.args[0],"actor-id")
            self.assertEqual(args.args[1],gateway.URL)
            body=args.kwargs["payload"]
            self.assertEqual(body["messages"][0]["role"],"system")
            self.assertIn("Trusted server contract",body["messages"][0]["content"])
            self.assertNotIn("actor-id",json.dumps(body))
            self.assertNotIn("synthetic-token",json.dumps(body))
            self.assertEqual(body["max_tokens"],900)
            self.assertEqual(body["temperature"],0)
            self.assertEqual(args.kwargs["timeout"],16)
            self.assertEqual(request.await_count,1)
        asyncio.run(run())

    def test_malformed_truncated_or_non_object_output_fails_closed(self):
        async def run():
            for obj in (None,{},response("[]"),response("not json"),response(finish="length"),
                        {"choices":[]},response("x"*20001),response("null")):
                request=AsyncMock(return_value=obj)
                with self.subTest(response_type=str(obj)[:50]),patch.dict(os.environ,ENV,clear=True),patch("app.ai_runtime.request_json",request):
                    with self.assertRaises(ValueError):
                        await gateway.completion("actor",ENV["AI_GATEWAY_MODEL"],"JSON",{})
                    self.assertEqual(request.await_count,1)
        asyncio.run(run())

    def test_unconfigured_or_oversized_input_does_not_make_network_request(self):
        async def run():
            request=AsyncMock(side_effect=AssertionError("network attempted"))
            with patch.dict(os.environ,{},clear=True),patch("app.ai_runtime.request_json",request):
                with self.assertRaisesRegex(ValueError,"gateway_credentials_missing"):
                    await gateway.completion("actor",ENV["AI_GATEWAY_MODEL"],"JSON",{})
            with patch.dict(os.environ,ENV,clear=True),patch("app.ai_runtime.request_json",request):
                for model,data,limit in (("bad",{},900),(ENV["AI_GATEWAY_MODEL"],{"text":"x"*60001},900),
                                         (ENV["AI_GATEWAY_MODEL"],{},2501),(ENV["AI_GATEWAY_MODEL"],{},True)):
                    with self.subTest(model=model,limit=limit),self.assertRaises(ValueError):
                        await gateway.completion("actor",model,"JSON",data,max_tokens=limit)
            request.assert_not_awaited()
        asyncio.run(run())

    def test_external_rollout_gate_precedes_transport(self):
        async def run():
            transport=AsyncMock(side_effect=AssertionError("provider called"))
            with self.assertRaisesRegex(RiwiProviderRouterError,"external_ai_disabled"):
                await dispatch_external_riwi_provider(None,
                    actor=RiwiActor("11111111-1111-4111-8111-111111111111","owner"),
                    provider_id="vercel",task_profile="general_tutoring",
                    payload={"language":"en","message":"Help"},correlation_id="fixture",
                    transport=transport,env=ENV)
            transport.assert_not_awaited()
        asyncio.run(run())

if __name__=="__main__":unittest.main()
