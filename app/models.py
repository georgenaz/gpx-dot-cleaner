from pydantic import BaseModel


class DeleteRequest(BaseModel):
    indices: list[int]


class TrackInfo(BaseModel):
    name: str | None
    total_points: int
    active_points: int
    deleted_points: int


class StateResponse(BaseModel):
    loaded: bool
    track_info: TrackInfo | None = None
    undo_levels: int = 0
