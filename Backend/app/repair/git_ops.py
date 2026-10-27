"""Plain git commands for the repair loop (worktrees, branches, commits).

The user's main working tree is never checked out, reset or committed to:
every change happens in a worktree under data/worktrees/<run_id>.
"""

import os
import subprocess
from pathlib import Path

from app.indexing.intake import remove_tree

GIT_TIMEOUT_S = 60
# Commits made by CodeXray use this identity, not the user's git config.
IDENTITY = ["-c", "user.name=CodeXray", "-c", "user.email=codexray@localhost"]
# Options for every command:
# - Git hooks are repo code: never run them outside the sandbox (e.g. post-checkout
#   on "worktree add"). Pointing hooksPath at the null device disables them all.
# - No CRLF conversion, so worktree files keep the LF endings that diffs use
#   (on Windows, core.autocrlf=true would make every LLM diff fail to apply).
OPTIONS = ["-c", f"core.hooksPath={os.devnull}", "-c", "core.autocrlf=false"]


class GitError(Exception):
    """A git command failed."""


def git(cwd: Path, *args: str) -> str:
    """Run one git command and return its stdout; raise GitError on failure."""
    try:
        result = subprocess.run(["git", *OPTIONS, *args], cwd=cwd, capture_output=True,
                                timeout=GIT_TIMEOUT_S)
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {args[0]} timed out") from exc
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise GitError(f"git {' '.join(args[:2])} failed: {stderr[:300]}")
    return result.stdout.decode("utf-8", errors="replace")


def toplevel(path: Path) -> Path | None:
    """The root of the git repository that contains path, or None."""
    try:
        return Path(git(path, "rev-parse", "--show-toplevel").strip()).resolve()
    except (GitError, OSError):
        return None


def head_commit(repo: Path) -> str:
    return git(repo, "rev-parse", "HEAD").strip()


def has_uncommitted_changes(repo: Path) -> bool:
    """True if tracked files differ from HEAD (they would not be in the repair branch)."""
    return bool(git(repo, "status", "--porcelain", "--untracked-files=no").strip())


def branch_exists(repo: Path, branch: str) -> bool:
    try:
        git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}")
        return True
    except GitError:
        return False


def add_worktree(repo: Path, path: Path, branch: str, base: str) -> None:
    """Create a new branch at base, checked out in a new worktree at path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    git(repo, "worktree", "add", "-b", branch, str(path), base)


def remove_worktree(repo: Path, path: Path) -> None:
    """Remove a worktree (even with changes in it). Safe to call twice."""
    try:
        git(repo, "worktree", "remove", "--force", str(path))
    except GitError:
        if path.exists():
            remove_tree(path)
    git(repo, "worktree", "prune")


def delete_branch(repo: Path, branch: str) -> None:
    """Delete a local branch. Safe to call when it does not exist."""
    if branch_exists(repo, branch):
        git(repo, "branch", "-D", branch)


def worktree_diff(worktree: Path) -> str:
    """The uncommitted changes in a worktree, as a unified diff."""
    return git(worktree, "diff", "--no-color", "--no-ext-diff", "HEAD")


def changed_files(worktree: Path) -> list[str]:
    """Every path that differs from HEAD in the worktree, including new files."""
    paths = []
    for line in git(worktree, "status", "--porcelain", "--untracked-files=all").splitlines():
        path = line[3:].strip().strip('"')
        if " -> " in path:  # a rename: "old -> new"
            paths += path.split(" -> ")
        else:
            paths.append(path)
    return paths


def show_file(worktree: Path, path: str) -> str | None:
    """A file as it is in HEAD, or None if it is new."""
    try:
        return git(worktree, "show", f"HEAD:{path}")
    except GitError:
        return None


def commit(worktree: Path, paths: list[str], message: str) -> str:
    """Commit the given paths in the worktree and return the new commit id."""
    git(worktree, "add", "--", *paths)
    git(worktree, *IDENTITY, "commit", "--no-verify", "-m", message)
    return head_commit(worktree)


def create_branch(repo: Path, branch: str, commit_id: str) -> None:
    git(repo, "branch", branch, commit_id)
