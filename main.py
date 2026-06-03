import json
import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from cvat_sdk import Client
from cvat_sdk.core.helpers import get_paginated_collection

load_dotenv()

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "92bcf3876dcf5a14d9808ea64abd40cf3649404c2feebff9f59eace72b6093e2")

load_dotenv()

CVAT_HOST = os.getenv("CVAT_HOST", "http://localhost:8080")
CVAT_USERNAME = os.getenv("CVAT_USERNAME", "admin")
CVAT_PASSWORD = os.getenv("CVAT_PASSWORD", "")
ORG_ID = int(os.getenv("ORG_ID", "6"))
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "92bcf3876dcf5a14d9808ea64abd40cf3649404c2feebff9f59eace72b6093e2")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")

USER_GROUPS = [
    ("СтГАУ", [
        "Weyd.K", "Gulevskiy.D", "Duchess.D", "Rosenthal.A",
        "Savenko.P", "Yurkevich.M", "Stavickaya.N", "Kondratyev.N",
        "Mastepanenko.M", "Dibrov.I", "Ryabokonova.I", "Selivanova.M",
        "Svazyan.A",
    ]),
    ("СПбГАУ", [
        "SPB10", "SPB9", "SPB8", "SPB7", "SPB6", "SPB5", "SPB4", "SPB3", "SPB2", "SPB1",
    ]),
    ("КБГАУ", [
        "Khamshokov.A", "Kasinov.G", "Nakhushev.A", "Atalikov.A",
        "Atalik.N", "Inal.N", "Amoral.N", "Berkhamov.Z",
    ]),
    ("ВГАУ", [
        "VOR.SomeoneFamous", "VOR.Roldugin", "VOR.Podlesny", "VOR.Tolstoy",
        "VOR.Simakov", "VOR.Mazov", "VOR.Skirliu", "VOR.Tyutina",
    ]),
    ("УлГАУ", []),
]

_ALL_USERNAMES = [u for _, users in USER_GROUPS for u in users]

app = FastAPI(title="НЦМУ Мониторинг разметки")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")


def get_client() -> Client:
    client = Client(url=CVAT_HOST, check_server_version=False)
    client.login((CVAT_USERNAME, CVAT_PASSWORD))
    return client


def _user_filter(usernames: list[str]) -> str:
    return json.dumps({
        "or": [
            {"in": [{"var": "owner"}, usernames]},
            {"in": [{"var": "assignee"}, usernames]},
        ]
    })


def _single_filter(field: str, value: str) -> str:
    return json.dumps({"==": [{"var": field}, value]})


_PAGE_SIZE = 10000


def _fetch_all(endpoint, **kwargs):
    """Fetch all items using pagination, returns list."""
    kwargs.setdefault("page_size", 500)
    return get_paginated_collection(endpoint=endpoint, **kwargs)


def _fetch_jobs_by_task_ids(client, task_ids: list[int]) -> list:
    """Fetch jobs for a list of task IDs, batching to avoid 414."""
    if not task_ids:
        return []
    all_jobs = []
    BATCH = 200
    for i in range(0, len(task_ids), BATCH):
        batch = task_ids[i:i + BATCH]
        jobs = get_paginated_collection(
            endpoint=client.api_client.jobs_api.list_endpoint,
            filter=json.dumps({"in": [{"var": "task_id"}, batch]}),
            page_size=500,
        )
        all_jobs.extend(jobs)
    return all_jobs


def _count_only(endpoint, **kwargs):
    """Get just the count of matching items (one API call, page_size=1)."""
    res, _ = endpoint.call_with_http_info(**kwargs, page=1, page_size=1)
    return res.count


def verify_token(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth.removeprefix("Bearer ") != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Неверный токен")


@app.get("/")
async def index():
    return index_html()


@app.post("/api/auth")
async def auth(request: Request):
    body = await request.json()
    token = body.get("token", "")
    if token == ADMIN_TOKEN:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="Неверный токен")


def index_html():
    with open(os.path.join(TEMPLATES_DIR, "index.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/groups", dependencies=[Depends(verify_token)])
async def list_groups():
    return [
        {"name": name, "usernames": users, "count": len(users)}
        for name, users in USER_GROUPS
    ]


@app.get("/api/groups/{group_name}/stats", dependencies=[Depends(verify_token)])
async def group_stats(group_name: str):
    usernames = None
    for name, users in USER_GROUPS:
        if name == group_name:
            usernames = users
            break

    if usernames is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if not usernames:
        return {"group": group_name, "total_projects": 0, "total_tasks": 0, "total_jobs": 0, "total_frames": 0, "jobs_by_status": {}, "jobs_by_stage": {}, "tasks_by_status": {}}

    client = get_client()
    try:
        flt = _user_filter(usernames)
        tasks = _fetch_all(
            endpoint=client.api_client.tasks_api.list_endpoint,
            filter=flt,
        )
        projects = _fetch_all(
            endpoint=client.api_client.projects_api.list_endpoint,
            filter=flt,
        )

        task_ids = [t.id for t in tasks]
        jobs = _fetch_jobs_by_task_ids(client, task_ids)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    total_jobs = len(jobs)
    total_frames = sum(getattr(j, "frame_count", 0) or 0 for j in jobs)

    jobs_by_status = {}
    jobs_by_stage = {}
    for j in jobs:
        s = str(j.status) if j.status else "unknown"
        jobs_by_status[s] = jobs_by_status.get(s, 0) + 1
        stage = str(getattr(j, "stage", "")) if getattr(j, "stage", None) else "unknown"
        jobs_by_stage[stage] = jobs_by_stage.get(stage, 0) + 1

    tasks_by_status = {}
    for t in tasks:
        s = str(t.status) if t.status else "unknown"
        tasks_by_status[s] = tasks_by_status.get(s, 0) + 1

    return {
        "group": group_name,
        "total_projects": len(projects),
        "total_tasks": len(tasks),
        "total_jobs": total_jobs,
        "total_frames": total_frames,
        "jobs_by_status": jobs_by_status,
        "jobs_by_stage": jobs_by_stage,
        "tasks_by_status": tasks_by_status,
    }


@app.get("/api/annotators", dependencies=[Depends(verify_token)])
async def list_annotators():
    client = get_client()
    try:
        memberships = get_paginated_collection(
            endpoint=client.api_client.memberships_api.list_endpoint,
            org_id=ORG_ID,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    cvat_users = {}
    for m in memberships:
        if m.user:
            cvat_users[m.user.username] = {
                "id": m.user.id,
                "username": m.user.username,
                "first_name": getattr(m.user, "first_name", "") or "",
                "last_name": getattr(m.user, "last_name", "") or "",
                "role": getattr(m, "role", None),
            }

    username_to_group = {}
    for name, users in USER_GROUPS:
        for u in users:
            username_to_group[u] = name

    result = []
    for username in _ALL_USERNAMES:
        info = cvat_users.get(username, {})
        result.append({
            "username": username,
            "group": username_to_group.get(username, ""),
            "id": info.get("id"),
            "first_name": info.get("first_name", ""),
            "last_name": info.get("last_name", ""),
            "role": info.get("role"),
        })

    return result


@app.get("/api/annotators/{username}/stats", dependencies=[Depends(verify_token)])
async def annotator_stats(username: str):
    if username not in _ALL_USERNAMES:
        raise HTTPException(status_code=404, detail="User not found")

    client = get_client()
    try:
        user_flt = _single_filter("owner", username)
        user_assignee_flt = _single_filter("assignee", username)
        user_or_flt = json.dumps({
            "or": [
                {"==": [{"var": "owner"}, username]},
                {"==": [{"var": "assignee"}, username]},
            ]
        })

        projects = _fetch_all(
            endpoint=client.api_client.projects_api.list_endpoint,
            filter=user_or_flt,
        )
        tasks = _fetch_all(
            endpoint=client.api_client.tasks_api.list_endpoint,
            filter=user_or_flt,
        )

        task_ids = [t.id for t in tasks]
        jobs = _fetch_jobs_by_task_ids(client, task_ids)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    total_jobs = len(jobs)
    total_frames = sum(getattr(j, "frame_count", 0) or 0 for j in jobs)

    jobs_by_status = {}
    jobs_by_stage = {}
    for j in jobs:
        s = str(j.status) if j.status else "unknown"
        jobs_by_status[s] = jobs_by_status.get(s, 0) + 1
        stage = str(getattr(j, "stage", "")) if getattr(j, "stage", None) else "unknown"
        jobs_by_stage[stage] = jobs_by_stage.get(stage, 0) + 1

    tasks_by_status = {}
    for t in tasks:
        s = str(t.status) if t.status else "unknown"
        tasks_by_status[s] = tasks_by_status.get(s, 0) + 1

    return {
        "username": username,
        "total_projects": len(projects),
        "total_tasks": len(tasks),
        "total_jobs": total_jobs,
        "total_frames": total_frames,
        "jobs_by_status": jobs_by_status,
        "jobs_by_stage": jobs_by_stage,
        "tasks_by_status": tasks_by_status,
    }


@app.get("/api/overview", dependencies=[Depends(verify_token)])
async def overview():
    if not _ALL_USERNAMES:
        return {"total_projects": 0, "total_tasks": 0, "total_jobs": 0, "total_annotators": 0}

    client = get_client()
    try:
        flt = _user_filter(_ALL_USERNAMES)

        projects_res, _ = client.api_client.projects_api.list_endpoint.call_with_http_info(
            filter=flt, page=1, page_size=1
        )
        tasks_res, _ = client.api_client.tasks_api.list_endpoint.call_with_http_info(
            filter=flt, page=1, page_size=1
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    return {
        "total_projects": projects_res.count,
        "total_tasks": tasks_res.count,
        "total_jobs": 0,
        "total_annotators": len(_ALL_USERNAMES),
    }


@app.get("/api/annotators/batch-stats", dependencies=[Depends(verify_token)])
async def annotators_batch_stats():
    if not _ALL_USERNAMES:
        return []

    client = get_client()
    try:
        user_flt = _user_filter(_ALL_USERNAMES)

        projects = _fetch_all(
            endpoint=client.api_client.projects_api.list_endpoint,
            filter=user_flt,
        )
        tasks = _fetch_all(
            endpoint=client.api_client.tasks_api.list_endpoint,
            filter=user_flt,
        )

        task_ids = [t.id for t in tasks]
        all_jobs = _fetch_jobs_by_task_ids(client, task_ids)

        task_jobs = {}
        for j in all_jobs:
            tid = getattr(j, "task_id", None)
            if tid is not None:
                if tid not in task_jobs:
                    task_jobs[tid] = []
                task_jobs[tid].append(j)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()

    username_to_group = {}
    for name, users in USER_GROUPS:
        for u in users:
            username_to_group[u] = name

    stats = {u: {"username": u, "group": username_to_group.get(u, ""), "total_projects": 0, "total_tasks": 0, "total_jobs": 0, "total_frames": 0, "jobs_by_status": {}, "tasks_by_status": {}} for u in _ALL_USERNAMES}

    for p in projects:
        if p.owner and p.owner.username in stats:
            stats[p.owner.username]["total_projects"] += 1

    for t in tasks:
        uname = None
        if t.assignee and t.assignee.username in stats:
            uname = t.assignee.username
        elif t.owner and t.owner.username in stats:
            uname = t.owner.username
        if uname:
            s = stats[uname]
            s["total_tasks"] += 1
            t_status = str(t.status) if t.status else "unknown"
            s["tasks_by_status"][t_status] = s["tasks_by_status"].get(t_status, 0) + 1

            for j in task_jobs.get(t.id, []):
                s["total_jobs"] += 1
                s["total_frames"] += getattr(j, "frame_count", 0) or 0
                j_status = str(j.status) if j.status else "unknown"
                s["jobs_by_status"][j_status] = s["jobs_by_status"].get(j_status, 0) + 1

    result = list(stats.values())
    result.sort(key=lambda x: x["total_jobs"], reverse=True)
    return result
