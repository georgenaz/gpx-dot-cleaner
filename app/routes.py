from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from app.gpx_service import GpxService
from app.models import DeleteRequest

router = APIRouter(prefix="/api")
service = GpxService()


@router.post("/upload")
async def upload_gpx(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".gpx"):
        raise HTTPException(400, "Only .gpx files are supported")
    content = await file.read()
    try:
        service.load(content)
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse GPX: {exc}") from exc
    return {"name": service.track_name, "total_points": service.total_points}


@router.get("/points")
async def get_points():
    if not service.loaded:
        raise HTTPException(400, "No GPX file loaded")
    return service.get_points()


@router.post("/points/delete")
async def delete_points(req: DeleteRequest):
    if not service.loaded:
        raise HTTPException(400, "No GPX file loaded")
    count = service.delete_points(req.indices)
    return {"deleted": count}


@router.post("/undo")
async def undo():
    if not service.loaded:
        raise HTTPException(400, "No GPX file loaded")
    restored, remaining = service.undo()
    return {"restored": restored, "remaining_undo_levels": remaining}


@router.get("/export")
async def export_gpx():
    if not service.loaded:
        raise HTTPException(400, "No GPX file loaded")
    data = service.export()
    return Response(
        content=data,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": "attachment; filename=cleaned.gpx"},
    )


@router.get("/state")
async def get_state():
    if not service.loaded:
        return {"loaded": False, "undo_levels": 0}
    return {
        "loaded": True,
        "track_info": {
            "name": service.track_name,
            "total_points": service.total_points,
            "active_points": service.active_points,
            "deleted_points": service.deleted_points,
        },
        "undo_levels": service.undo_levels,
    }
