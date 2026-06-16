from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Depends
from pydantic import BaseModel
import os, uuid
import asyncio

app = FastAPI(title="LeadStealth API")
API_KEY = os.getenv("LEADSTEALTH_API_KEY", "")

if not API_KEY:
    raise RuntimeError("LEADSTEALTH_API_KEY environment variable is required")

def verify_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

class ScrapeRequest(BaseModel):
    query: str
    location: str
    sources: list[str] = ["google_maps", "yellowpages", "yelp"]
    max_results: int = 50

class ScrapeJob(BaseModel):
    job_id: str
    status: str
    leads_found: int = 0

_jobs: dict[str, dict] = {}

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/scrape", dependencies=[Depends(verify_key)])
async def start_scrape(req: ScrapeRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "running", "leads_found": 0, "started_at": asyncio.get_event_loop().time()}
    # Simulate background work
    background_tasks.add_task(_run_scrape, job_id, req)
    return {"job_id": job_id, "status": "running"}

async def _run_scrape(job_id: str, req: ScrapeRequest):
    # Placeholder implementation – in a real system this would perform scraping
    await asyncio.sleep(2)  # simulate work
    _jobs[job_id] = {"status": "completed", "leads_found": 10, "completed_at": asyncio.get_event_loop().time()}

@app.get("/scrape/{job_id}", dependencies=[Depends(verify_key)])
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.get("/leads", dependencies=[Depends(verify_key)])
def get_leads(limit: int = 100, source: str | None = None):
    # Return dummy leads
    dummy = [{"email": f"test{i}@example.com", "name": f"Test User {i}"} for i in range(1, limit + 1)]
    return {"data": dummy, "total": limit}
