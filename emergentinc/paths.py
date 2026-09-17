"""统一项目路径定义与契约 (Centralized Project Paths)."""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union

PathLike = Union[str, Path]


@dataclass(frozen=True)
class ProjectPaths:
    """不可变项目路径容器 (Immutable Project Paths Container)."""

    project_root: Path
    resources_root: Path
    workspace_root: Path
    live_root: Path
    loops_root: Path
    runtime_root: Path
    private_root: Path
    ui_state_root: Path
    cache_root: Path
    scratch_root: Path

    @property
    def ledger_root(self) -> Path:
        return self.workspace_root / "ledger"

    @property
    def config_dir(self) -> Path:
        return self.resources_root / "config"

    @property
    def schemas_dir(self) -> Path:
        return self.resources_root / "schemas"

    @property
    def prompts_dir(self) -> Path:
        return self.resources_root / "prompts"

    @property
    def templates_dir(self) -> Path:
        return self.resources_root / "templates"

    @property
    def experiments_dir(self) -> Path:
        return self.resources_root / "experiments"

    @property
    def bootstrap_dir(self) -> Path:
        return self.resources_root / "bootstrap"

    @property
    def env_file(self) -> Path:
        return self.project_root / ".env"

    @property
    def tests_root(self) -> Path:
        return self.project_root / "tests"

    @property
    def docs_root(self) -> Path:
        return self.project_root / "docs"

    @property
    def frontend_dist(self) -> Path:
        return self.project_root / "frontend" / "dist"

    def with_workspace(self, workspace: PathLike) -> "ProjectPaths":
        """派生指向不同工作区的 ProjectPaths 实例."""
        ws = Path(workspace).resolve()
        return ProjectPaths(
            project_root=self.project_root,
            resources_root=self.resources_root,
            workspace_root=ws,
            live_root=ws / "live",
            loops_root=ws / "loops",
            runtime_root=ws / "runtime",
            private_root=ws / "private",
            ui_state_root=ws / "ui_state",
            cache_root=ws / "cache",
            scratch_root=ws / "scratch",
        )


def get_paths(workspace: Optional[PathLike] = None) -> ProjectPaths:
    """解析并返回 ProjectPaths 对象.

    - project_root 始终基于当前 paths.py 所在位置解析 (绝对路径)
    - 默认 workspace 固定为 <project_root>/workspace
    - 如传入 workspace，则将其解析为绝对路径作为 workspace_root
    """
    pkg_dir = Path(__file__).resolve().parent
    proj_root = pkg_dir.parent.resolve()
    resources_root = proj_root / "resources"

    if workspace is not None:
        ws_root = Path(workspace).resolve()
    else:
        ws_root = proj_root / "workspace"

    return ProjectPaths(
        project_root=proj_root,
        resources_root=resources_root,
        workspace_root=ws_root,
        live_root=ws_root / "live",
        loops_root=ws_root / "loops",
        runtime_root=ws_root / "runtime",
        private_root=ws_root / "private",
        ui_state_root=ws_root / "ui_state",
        cache_root=ws_root / "cache",
        scratch_root=ws_root / "scratch",
    )
