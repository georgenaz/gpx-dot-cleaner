"""GPX parsing, state management, and export using stdlib ElementTree."""

import io
from copy import deepcopy
from typing import Optional
import xml.etree.ElementTree as ET


class GpxService:
    def __init__(self) -> None:
        self._tree: Optional[ET.ElementTree] = None
        self._points: list[dict] = []
        self._deleted: set[int] = set()
        self._undo_stack: list[set[int]] = []
        self._ns: str = ""
        self._track_name: Optional[str] = None

    def load(self, content: bytes) -> None:
        self._tree = ET.parse(io.BytesIO(content))
        root = self._tree.getroot()
        tag = root.tag
        if tag.startswith("{"):
            self._ns = tag[1:tag.index("}")]
        else:
            self._ns = ""

        trk = self._find(root, "trk")
        if trk is not None:
            name_el = self._find(trk, "name")
            self._track_name = name_el.text if name_el is not None else None
        else:
            self._track_name = None

        self._points = []
        trkpts = root.findall(f".//{{{self._ns}}}trkpt") if self._ns else root.findall(".//trkpt")
        for i, pt in enumerate(trkpts):
            lat = float(pt.get("lat"))
            lon = float(pt.get("lon"))
            ele_el = self._find(pt, "ele")
            ele = float(ele_el.text) if ele_el is not None else None
            time_el = self._find(pt, "time")
            time_val = time_el.text if time_el is not None else None
            self._points.append({"index": i, "lat": lat, "lon": lon, "ele": ele, "time": time_val})

        self._deleted = set()
        self._undo_stack = []

    @property
    def loaded(self) -> bool:
        return self._tree is not None

    @property
    def track_name(self) -> Optional[str]:
        return self._track_name

    @property
    def total_points(self) -> int:
        return len(self._points)

    @property
    def active_points(self) -> int:
        return len(self._points) - len(self._deleted)

    @property
    def deleted_points(self) -> int:
        return len(self._deleted)

    @property
    def undo_levels(self) -> int:
        return len(self._undo_stack)

    def get_points(self) -> list[dict]:
        return [{**pt, "deleted": pt["index"] in self._deleted} for pt in self._points]

    def delete_points(self, indices: list[int]) -> int:
        new_deletions: set[int] = set()
        for idx in indices:
            if 0 <= idx < len(self._points) and idx not in self._deleted:
                new_deletions.add(idx)
                self._deleted.add(idx)
        if new_deletions:
            self._undo_stack.append(new_deletions)
        return len(new_deletions)

    def undo(self) -> tuple[int, int]:
        if not self._undo_stack:
            return 0, 0
        last = self._undo_stack.pop()
        self._deleted -= last
        return len(last), len(self._undo_stack)

    def export(self) -> bytes:
        if self._tree is None:
            raise ValueError("No GPX loaded")
        tree_copy = deepcopy(self._tree)
        root = tree_copy.getroot()
        tag = f"{{{self._ns}}}trkpt" if self._ns else "trkpt"
        to_remove = []
        for parent in root.iter():
            for child in parent:
                if child.tag == tag:
                    to_remove.append((parent, child))
        for parent, child in to_remove:
            lat = float(child.get("lat"))
            lon = float(child.get("lon"))
            idx = self._find_point_index(lat, lon)
            if idx is not None and idx in self._deleted:
                parent.remove(child)
        buf = io.BytesIO()
        tree_copy.write(buf, xml_declaration=True, encoding="utf-8")
        return buf.getvalue()

    def _find_point_index(self, lat: float, lon: float) -> Optional[int]:
        for pt in self._points:
            if pt["lat"] == lat and pt["lon"] == lon:
                return pt["index"]
        return None

    def _find(self, parent: ET.Element, tag: str) -> Optional[ET.Element]:
        full = f"{{{self._ns}}}{tag}" if self._ns else tag
        return parent.find(full)
