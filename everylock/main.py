"""EveryLock FastAPI application. Bind this app only to 127.0.0.1."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from models import PolicyName, SimulationConfig
from simulation import SimulationEngine


BASE_DIR = Path(__file__).resolve().parent
engine = SimulationEngine()
simulation_task: asyncio.Task[None] | None = None


class ConfigRequest(BaseModel):
    user_count: int = Field(1000, ge=100, le=10_000)
    failure_events: int = Field(10_000, ge=1, le=1_000_000)
    lock_threshold: int = Field(10, ge=1, le=100)
    events_per_second: int = Field(100, ge=1, le=10_000)
    seed: int = Field(2026, ge=0, le=2_147_483_647)


class UnlockRequest(BaseModel):
    user_id: str
    policy: PolicyName = PolicyName.A


async def simulation_loop() -> None:
    while engine.running and not engine.completed:
        if engine.paused:
            await asyncio.sleep(0.1)
            continue
        batch = max(1, min(200, engine.config.events_per_second // 10))
        engine.process_batch(batch)
        await asyncio.sleep(batch / engine.config.events_per_second)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    global simulation_task
    if simulation_task and not simulation_task.done():
        simulation_task.cancel()
        with suppress(asyncio.CancelledError):
            await simulation_task


app = FastAPI(title="EveryLock", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "templates" / "index.html")


@app.get("/api/status")
async def status() -> dict[str, object]:
    return engine.snapshot()


@app.post("/api/start")
async def start(config: ConfigRequest | None = None) -> dict[str, object]:
    global simulation_task
    if config is not None and engine.event_count == 0 and not engine.running:
        engine.reset(SimulationConfig(**config.model_dump()))
    if engine.completed:
        raise HTTPException(409, "완료된 시뮬레이션입니다. 초기화 후 다시 시작하세요.")
    engine.running = True
    engine.paused = False
    if simulation_task is None or simulation_task.done():
        simulation_task = asyncio.create_task(simulation_loop())
    return engine.snapshot()


@app.post("/api/pause")
async def pause() -> dict[str, object]:
    engine.running = False
    engine.paused = True
    return engine.snapshot()


@app.post("/api/reset")
async def reset(config: ConfigRequest) -> dict[str, object]:
    global simulation_task
    if simulation_task and not simulation_task.done():
        simulation_task.cancel()
    engine.reset(SimulationConfig(**config.model_dump()))
    return engine.snapshot()


@app.post("/api/step")
async def step(amount: int = 1) -> dict[str, object]:
    engine.process_batch(max(1, min(amount, 10_000)))
    return engine.snapshot()


@app.post("/api/unlock")
async def unlock(request: UnlockRequest) -> dict[str, object]:
    if not engine.unlock(request.user_id, request.policy):
        raise HTTPException(404, "가상 계정을 찾을 수 없습니다.")
    return engine.snapshot()


@app.get("/api/report")
async def report() -> dict[str, object]:
    return engine.report()


@app.get("/api/export/json")
async def export_json() -> PlainTextResponse:
    return PlainTextResponse(
        engine.export_json(),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=everylock-report.json"},
    )


@app.get("/api/export/csv")
async def export_csv() -> PlainTextResponse:
    return PlainTextResponse(
        "\ufeff" + engine.export_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=everylock-report.csv"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
