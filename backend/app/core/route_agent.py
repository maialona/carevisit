from __future__ import annotations

import json
import uuid
from datetime import date
from typing import AsyncGenerator, Optional

import httpx
from openai import AsyncOpenAI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.compliance import compute_compliance
from app.core.config import settings
from app.models.models import CaseProfile, User, UserRole

MAX_ITERATIONS = 10
DEFAULT_ORIGIN = "台南市北區臨安路二段17號"
TAIWAN_REGION = "TW"


def _sse(event_type: str, **kwargs) -> str:
    return f"data: {json.dumps({'type': event_type, **kwargs}, ensure_ascii=False)}\n\n"


class RouteAgent:
    def __init__(self, db: AsyncSession, current_user: User):
        self.db = db
        self.user = current_user
        self.llm = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0)
        self.gmaps_key = settings.GOOGLE_MAPS_API_KEY

    async def run(
        self,
        target_date: date,
        origin: str,
    ) -> AsyncGenerator[str, None]:
        state: dict = {
            "target_date": target_date,
            "origin": origin or DEFAULT_ORIGIN,
            "cases": [],
            "geocoded": [],
            "failed_geocode": [],
            "route": None,
            "warnings": [],
            "retry_used": False,
        }

        yield _sse("thinking", step="ACT", content=f"查詢 {target_date.strftime('%Y/%m/%d')} 需安排家訪的個案（overdue / due_soon）...")
        await self._fetch_cases(state)
        n = len(state["cases"])
        has_addr = sum(1 for c in state["cases"] if c.get("address"))
        yield _sse("thinking", step="OBSERVE", content=f"找到 {n} 位需訪視個案，其中 {has_addr} 位有地址記錄，{n - has_addr} 位無地址")

        if n == 0:
            yield _sse("thinking", step="REFLECT", content="今日無 overdue/due_soon 個案，無需安排家訪路線")
            yield _sse("result", route=[], total_duration_min=0, total_distance_km=0, origin=state["origin"], missing_cases=[], warnings=[], summary="今日無需安排家訪的個案")
            yield _sse("done")
            return

        async for event in self._execute_loop(state, initial_action="geocode"):
            yield event

    async def run_manual(
        self,
        case_ids: list[uuid.UUID],
        origin: str,
    ) -> AsyncGenerator[str, None]:
        """Manual mode: user-selected cases, skip compliance fetch."""
        state: dict = {
            "target_date": date.today(),
            "origin": origin or DEFAULT_ORIGIN,
            "cases": [],
            "geocoded": [],
            "failed_geocode": [],
            "route": None,
            "warnings": [],
            "retry_used": False,
        }

        await self._use_selected_cases(state, case_ids)
        n = len(state["cases"])
        has_addr = sum(1 for c in state["cases"] if c.get("address"))
        yield _sse("thinking", step="ACT", content=f"已選取 {n} 位個案（{has_addr} 位有地址），開始地理編碼...")

        if n == 0:
            yield _sse("thinking", step="REFLECT", content="未找到選取的個案資料，請確認選取內容")
            yield _sse("result", route=[], total_duration_min=0, total_distance_km=0, origin=state["origin"], missing_cases=[], warnings=[], summary="未找到選取的個案")
            yield _sse("done")
            return

        async for event in self._execute_loop(state, initial_action="geocode"):
            yield event

    async def _execute_loop(
        self,
        state: dict,
        initial_action: str,
    ) -> AsyncGenerator[str, None]:
        """Shared agentic loop: geocode → [retry_geocode] → optimize_route → finalize."""
        action = initial_action
        iteration = 0

        while iteration < MAX_ITERATIONS and action not in ("done", "abort"):
            iteration += 1

            if action == "geocode":
                to_geocode = sum(1 for c in state["cases"] if c.get("address"))
                yield _sse("thinking", step="ACT", content=f"對 {to_geocode} 個地址進行地理編碼...")
                await self._geocode_all(state)
                ok = len(state["geocoded"])
                fail = len(state["failed_geocode"])
                failed_names = "、".join(f["name"] for f in state["failed_geocode"][:4])
                extra = f"（{failed_names}{'…' if fail > 4 else ''}）" if fail else ""
                yield _sse("thinking", step="OBSERVE", content=f"地理編碼：{ok} 筆成功，{fail} 筆失敗{extra}")

                action = await self._llm_decide(state, action, iteration)
                yield _sse("thinking", step="REFLECT", content=f"決策 → {action}")

            elif action == "retry_geocode":
                n_fail = len(state["failed_geocode"])
                yield _sse("thinking", step="ACT", content=f"請 LLM 嘗試修正 {n_fail} 個問題地址並重試...")
                newly_ok = await self._retry_geocode(state)
                still_fail = len(state["failed_geocode"])
                yield _sse("thinking", step="OBSERVE", content=f"重試結果：新增 {newly_ok} 筆成功，仍有 {still_fail} 筆無法編碼")
                if still_fail:
                    state["warnings"].append(f"{still_fail} 位個案因地址問題無法排入路線")

                action = await self._llm_decide(state, action, iteration)
                yield _sse("thinking", step="REFLECT", content=f"決策 → {action}")

            elif action == "optimize_route":
                if not state["geocoded"]:
                    yield _sse("thinking", step="REFLECT", content="無有效地址，中止路線規劃")
                    yield _sse("result", route=[], total_duration_min=0, total_distance_km=0, origin=state["origin"], missing_cases=[{"name": c["name"], "address": c.get("address", ""), "compliance": c.get("compliance", "overdue")} for c in state["cases"]], warnings=state["warnings"], summary="無法取得有效地址，請確認個案地址資料")
                    yield _sse("done")
                    return

                n_wp = len(state["geocoded"])
                yield _sse("thinking", step="ACT", content=f"呼叫 Google Directions API（起點：{state['origin']}，{n_wp} 個停靠點）...")
                route_ok = await self._optimize_route(state)

                if route_ok:
                    total_min = state["route"]["total_duration_min"]
                    total_km = state["route"]["total_distance_km"]
                    yield _sse("thinking", step="OBSERVE", content=f"路線規劃完成：{n_wp} 停靠點，預計 {total_min} 分鐘，{total_km} 公里")
                else:
                    yield _sse("thinking", step="OBSERVE", content="Google Directions API 回傳異常，改用原始順序排列")
                    state["warnings"].append("路線未最佳化（API 錯誤），以原始順序排列")

                action = await self._llm_decide(state, action, iteration)
                yield _sse("thinking", step="REFLECT", content=f"決策 → {action}")

            elif action == "finalize":
                yield _sse("thinking", step="REFLECT", content="整理結果並產生摘要...")
                summary = await self._llm_summarize(state)
                yield _sse("thinking", step="REFLECT", content=summary)

                geocoded_ids = {g["case_id"] for g in state["geocoded"]}
                missing_cases = [
                    {"name": c["name"], "address": c.get("address", "（無地址）"), "compliance": c.get("compliance", "overdue")}
                    for c in state["cases"]
                    if c["case_id"] not in geocoded_ids
                ]

                yield _sse(
                    "result",
                    route=state["route"]["stops"] if state["route"] else [],
                    total_duration_min=state["route"]["total_duration_min"] if state["route"] else 0,
                    total_distance_km=state["route"]["total_distance_km"] if state["route"] else 0,
                    origin=state["origin"],
                    missing_cases=missing_cases,
                    warnings=state["warnings"],
                    summary=summary,
                )
                yield _sse("done")
                return

            elif action == "abort":
                yield _sse("thinking", step="REFLECT", content="Agent 中止：無法規劃有效路線")
                yield _sse("result", route=[], total_duration_min=0, total_distance_km=0, origin=state["origin"], missing_cases=[{"name": c["name"], "address": c.get("address", ""), "compliance": c.get("compliance", "overdue")} for c in state["cases"]], warnings=state["warnings"], summary="無法規劃路線，請確認個案地址資料是否完整")
                yield _sse("done")
                return

        # Exceeded max iterations
        yield _sse("thinking", step="REFLECT", content=f"已達最大迭代次數（{MAX_ITERATIONS}），輸出目前結果")
        geocoded_ids = {g["case_id"] for g in state["geocoded"]}
        missing_cases = [
            {"name": c["name"], "address": c.get("address", ""), "compliance": c.get("compliance", "overdue")}
            for c in state["cases"]
            if c["case_id"] not in geocoded_ids
        ]
        yield _sse(
            "result",
            route=state["route"]["stops"] if state.get("route") else [],
            total_duration_min=state["route"]["total_duration_min"] if state.get("route") else 0,
            total_distance_km=state["route"]["total_distance_km"] if state.get("route") else 0,
            origin=state["origin"],
            missing_cases=missing_cases,
            warnings=state["warnings"],
            summary="已達最大迭代次數，結果可能不完整",
        )
        yield _sse("done")

    # ──────────────────────────────────────────────────────────────────────────
    # Tools
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _build_address(case: CaseProfile) -> str:
        """Combine district + road + address into a clean, geocodable string."""
        import re
        import unicodedata

        parts = [
            (case.district or "").strip(),
            (case.road or "").strip(),
            (case.address or "").strip(),
        ]
        combined = "".join(parts)
        if not combined:
            return ""

        # Normalize full-width digits/letters → half-width (１１６ → 116)
        combined = unicodedata.normalize("NFKC", combined)

        # Strip notes after Chinese full stop (e.g. 。公文寄送地→...)
        combined = re.sub(r"。.*", "", combined)

        # Strip city name wherever it appears (will prepend correctly below)
        combined = re.sub(r"[台臺]南市", "", combined).strip()

        # Remove neighborhood numbers (e.g. 012鄰, 3鄰)
        combined = re.sub(r"\d+鄰", "", combined)

        # Remove floor/unit suffixes (1F, 2F, B1, 1樓, 2樓以上…)
        combined = re.sub(r"\d*[Ff]\d*", "", combined)
        combined = re.sub(r"\d+樓.*", "", combined)

        combined = combined.strip()
        return f"臺南市{combined}" if combined else ""

    async def _fetch_cases(self, state: dict) -> None:
        q = select(CaseProfile).where(CaseProfile.org_id == self.user.org_id)
        if self.user.role != UserRole.admin:
            q = q.where(CaseProfile.supervisor == self.user.name)

        result = await self.db.execute(q)
        all_cases = result.scalars().all()
        case_ids = [c.id for c in all_cases]

        last_visits = await self._get_last_visits(case_ids)

        today = state["target_date"]
        target = []
        for case in all_cases:
            lv = last_visits.get(case.id, {})
            _, _, overall = compute_compliance(lv.get("phone"), lv.get("home"), today)
            if overall.value in ("overdue", "due_soon"):
                target.append({
                    "case_id": str(case.id),
                    "name": case.name,
                    "address": self._build_address(case),
                    "district": case.district or "",
                    "phone": case.phone or "",
                    "compliance": overall.value,
                })

        state["cases"] = target

    async def _use_selected_cases(self, state: dict, case_ids: list[uuid.UUID]) -> None:
        """Populate state['cases'] from an explicit list of case IDs."""
        if not case_ids:
            return
        result = await self.db.execute(
            select(CaseProfile).where(
                CaseProfile.id.in_(case_ids),
                CaseProfile.org_id == self.user.org_id,
            )
        )
        cases = result.scalars().all()
        state["cases"] = [
            {
                "case_id": str(c.id),
                "name": c.name,
                "address": self._build_address(c),
                "district": c.district or "",
                "phone": c.phone or "",
                "compliance": "overdue",
            }
            for c in cases
        ]

    async def _get_last_visits(self, case_ids: list[uuid.UUID]) -> dict:
        if not case_ids:
            return {}
        result = await self.db.execute(
            text("""
                SELECT DISTINCT ON (case_profile_id, visit_type)
                    case_profile_id,
                    visit_type,
                    visit_date::date AS visit_date
                FROM visit_records
                WHERE case_profile_id = ANY(:ids)
                  AND status = 'completed'
                ORDER BY case_profile_id, visit_type, visit_date DESC
            """),
            {"ids": case_ids},
        )
        rows = result.fetchall()
        data: dict = {}
        for row in rows:
            cid = row.case_profile_id
            if cid not in data:
                data[cid] = {"phone": None, "home": None}
            if row.visit_type == "phone":
                data[cid]["phone"] = row.visit_date
            elif row.visit_type == "home":
                data[cid]["home"] = row.visit_date
        return data

    async def _geocode_address(self, address: str) -> Optional[dict]:
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": address,
            "region": TAIWAN_REGION,
            "language": "zh-TW",
            "key": self.gmaps_key,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                data = resp.json()
            if data.get("status") == "OK" and data.get("results"):
                loc = data["results"][0]["geometry"]["location"]
                return {
                    "lat": loc["lat"],
                    "lng": loc["lng"],
                    "formatted_address": data["results"][0]["formatted_address"],
                }
        except Exception:
            pass
        return None

    async def _geocode_all(self, state: dict) -> None:
        state["geocoded"] = []
        state["failed_geocode"] = []
        for case in state["cases"]:
            addr = case["address"]
            if not addr:
                state["failed_geocode"].append({**case, "reason": "無地址"})
                continue
            result = await self._geocode_address(addr)
            if result:
                state["geocoded"].append({
                    "case_id": case["case_id"],
                    "name": case["name"],
                    "address": addr,
                    "formatted_address": result["formatted_address"],
                    "lat": result["lat"],
                    "lng": result["lng"],
                    "compliance": case["compliance"],
                })
            else:
                state["failed_geocode"].append({**case, "reason": "地址無法解析"})

    async def _retry_geocode(self, state: dict) -> int:
        if not state["failed_geocode"]:
            return 0

        failed_list = "\n".join(
            f"- {f['name']}: {f['address'] or '（無地址）'} [區域: {f.get('district', '')}]"
            for f in state["failed_geocode"]
        )
        prompt = (
            "以下台灣地址在 Google Geocoding API 無法解析，請嘗試修正格式"
            "（補全縣市、行政區，或修正常見錯字）：\n"
            f"{failed_list}\n\n"
            "回傳 JSON 陣列，每個元素：{\"name\": \"個案名\", \"corrected_address\": \"修正後完整地址\"}\n"
            "若無法修正則 corrected_address 留空字串。只輸出 JSON，不要加說明。"
        )

        response = await self.llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
            temperature=0.2,
        )

        raw = (response.choices[0].message.content or "[]").strip()
        raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
        try:
            suggestions = json.loads(raw)
        except json.JSONDecodeError:
            return 0

        newly_ok = 0
        still_failed = []
        for failed in state["failed_geocode"]:
            suggestion = next((s for s in suggestions if s.get("name") == failed["name"]), None)
            corrected = (suggestion or {}).get("corrected_address", "").strip()
            if corrected:
                result = await self._geocode_address(corrected)
                if result:
                    state["geocoded"].append({
                        "case_id": failed["case_id"],
                        "name": failed["name"],
                        "address": corrected,
                        "formatted_address": result["formatted_address"],
                        "lat": result["lat"],
                        "lng": result["lng"],
                        "compliance": failed["compliance"],
                    })
                    newly_ok += 1
                    continue
            still_failed.append(failed)

        state["failed_geocode"] = still_failed
        state["retry_used"] = True
        return newly_ok

    async def _optimize_route(self, state: dict) -> bool:
        geocoded = state["geocoded"]
        if not geocoded:
            return False

        if len(geocoded) == 1:
            state["route"] = {
                "stops": [{
                    "order": 1,
                    "case_id": geocoded[0]["case_id"],
                    "name": geocoded[0]["name"],
                    "address": geocoded[0]["address"],
                    "formatted_address": geocoded[0]["formatted_address"],
                    "compliance": geocoded[0]["compliance"],
                    "duration_from_prev_min": None,
                    "distance_from_prev_km": None,
                }],
                "total_duration_min": 0,
                "total_distance_km": 0,
            }
            return True

        origin = state["origin"]
        waypoints_coords = [f"{g['lat']},{g['lng']}" for g in geocoded]

        params = {
            "origin": origin,
            "destination": origin,
            "waypoints": "optimize:true|" + "|".join(waypoints_coords),
            "mode": "driving",
            "language": "zh-TW",
            "region": "TW",
            "key": self.gmaps_key,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    "https://maps.googleapis.com/maps/api/directions/json",
                    params=params,
                )
                data = resp.json()
        except Exception:
            state["route"] = self._fallback_route(geocoded)
            return False

        if data.get("status") != "OK":
            state["route"] = self._fallback_route(geocoded)
            return False

        route = data["routes"][0]
        optimized_order: list[int] = route.get("waypoint_order", list(range(len(geocoded))))
        legs = route["legs"]

        stops = []
        total_duration = 0
        total_distance = 0

        for idx, wp_idx in enumerate(optimized_order):
            case = geocoded[wp_idx]
            leg = legs[idx]
            dur_sec = leg["duration"]["value"]
            dist_m = leg["distance"]["value"]
            total_duration += dur_sec
            total_distance += dist_m
            stops.append({
                "order": idx + 1,
                "case_id": case["case_id"],
                "name": case["name"],
                "address": case["address"],
                "formatted_address": case["formatted_address"],
                "compliance": case["compliance"],
                "duration_from_prev_min": round(dur_sec / 60),
                "distance_from_prev_km": round(dist_m / 1000, 1),
            })

        state["route"] = {
            "stops": stops,
            "total_duration_min": round(total_duration / 60),
            "total_distance_km": round(total_distance / 1000, 1),
        }
        return True

    def _fallback_route(self, geocoded: list) -> dict:
        return {
            "stops": [
                {
                    "order": i + 1,
                    "case_id": g["case_id"],
                    "name": g["name"],
                    "address": g["address"],
                    "formatted_address": g["formatted_address"],
                    "compliance": g["compliance"],
                    "duration_from_prev_min": None,
                    "distance_from_prev_km": None,
                }
                for i, g in enumerate(geocoded)
            ],
            "total_duration_min": 0,
            "total_distance_km": 0,
        }

    # ──────────────────────────────────────────────────────────────────────────
    # LLM decision / reflection
    # ──────────────────────────────────────────────────────────────────────────

    def _available_actions(self, current_action: str, state: dict) -> list[str]:
        n_geocoded = len(state["geocoded"])
        n_failed = len(state["failed_geocode"])
        retry_used = state.get("retry_used", False)

        if current_action == "fetch_cases":
            return ["geocode"]

        if current_action == "geocode":
            options = []
            if n_failed > 0 and not retry_used:
                options.append("retry_geocode")
            if n_geocoded > 0:
                options.append("optimize_route")
            return options or ["abort"]

        if current_action == "retry_geocode":
            if n_geocoded > 0:
                return ["optimize_route", "finalize"]
            return ["abort"]

        if current_action == "optimize_route":
            return ["finalize"]

        return ["finalize"]

    async def _llm_decide(self, state: dict, current_action: str, iteration: int) -> str:
        available = self._available_actions(current_action, state)
        if len(available) == 1:
            return available[0]

        context = (
            f"迭代 {iteration}/{MAX_ITERATIONS} | 上一步：{current_action}\n"
            f"個案總數：{len(state['cases'])}，geocode 成功：{len(state['geocoded'])}，失敗：{len(state['failed_geocode'])}\n"
            f"已規劃路線：{'是' if state['route'] else '否'}\n"
            f"retry_geocode 已使用：{'是' if state.get('retry_used') else '否'}\n"
        )
        prompt = (
            f"你是路線規劃 Agent 的決策模組。根據以下狀態選擇下一步動作：\n\n"
            f"{context}\n"
            f"可用動作（只能選一個）：{available}\n\n"
            f"- retry_geocode：LLM 嘗試修正問題地址（每次執行只能用一次）\n"
            f"- optimize_route：呼叫 Google Directions API 規劃最佳路線\n"
            f"- finalize：整理結果並結束\n"
            f"- abort：完全無法處理時使用\n\n"
            f"只回傳動作名稱，不加任何說明。"
        )

        response = await self.llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=15,
            temperature=0.1,
        )

        action = (response.choices[0].message.content or "").strip().lower()
        return action if action in available else available[0]

    async def _llm_summarize(self, state: dict) -> str:
        n_stops = len(state["route"]["stops"]) if state.get("route") else 0
        total_min = state["route"]["total_duration_min"] if state.get("route") else 0
        total_km = state["route"]["total_distance_km"] if state.get("route") else 0
        n_missing = len(state["cases"]) - n_stops
        order_str = " → ".join(s["name"] for s in (state["route"]["stops"] if state.get("route") else []))

        context = (
            f"路線規劃結果：{n_stops} 個停靠點，預計 {total_min} 分鐘，{total_km} 公里\n"
            f"起點：{state['origin']}\n"
            f"建議訪視順序：{order_str or '（無）'}\n"
            f"無法排入（地址問題）：{n_missing} 位\n"
            f"警告：{', '.join(state['warnings']) or '無'}\n"
        )

        response = await self.llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "你是長照督導員的行程助理，用簡短繁體中文（2-3句）說明路線規劃結果。"},
                {"role": "user", "content": context},
            ],
            max_tokens=150,
            temperature=0.3,
        )

        return (response.choices[0].message.content or "路線規劃完成").strip()
