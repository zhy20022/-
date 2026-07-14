import os
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


BACKEND_PORT = 5000
FRONTEND_PORT = 3000


def project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def is_port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def find_python(root: Path) -> str:
    venv_python = root / ".venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        return str(venv_python)
    return "python"


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def run_checked(command: list[str], cwd: Path, title: str) -> bool:
    print(f"[检查] {title}...")
    try:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=20)
    except Exception as error:
        print(f"[错误] {title}失败: {error}")
        return False
    if result.returncode != 0:
        print(f"[错误] {title}失败")
        if result.stderr:
            print(result.stderr.strip())
        return False
    first_line = (result.stdout or result.stderr or "").strip().splitlines()
    if first_line:
        print(f"[OK] {first_line[0]}")
    else:
        print("[OK]")
    return True


def start_cmd_window(title: str, command: str, cwd: Path) -> None:
    if os.name == "nt":
        subprocess.Popen(
            ["cmd.exe", "/k", f"title {title} && cd /d {cwd} && {command}"],
            cwd=cwd,
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    else:
        subprocess.Popen(command, cwd=cwd, shell=True)


def wait_for_port(port: int, seconds: int) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if is_port_open(port):
            return True
        time.sleep(0.5)
    return is_port_open(port)


def ensure_frontend_deps(root: Path) -> bool:
    web_dir = root / "web"
    if (web_dir / "node_modules").exists():
        print("[OK] 前端依赖已存在")
        return True
    print("[首次运行] 正在安装前端依赖，这可能需要几分钟...")
    try:
        result = subprocess.run([npm_command(), "install"], cwd=web_dir, timeout=600)
    except Exception as error:
        print(f"[错误] 前端依赖安装失败: {error}")
        return False
    if result.returncode != 0:
        print("[错误] 前端依赖安装失败，请进入 web 目录手动运行 npm install")
        return False
    print("[OK] 前端依赖安装完成")
    return True


def main() -> int:
    root = project_root()
    python_exe = find_python(root)
    web_dir = root / "web"

    print("=" * 54)
    print("  灾异志 - 一键启动器")
    print("=" * 54)
    print(f"项目目录: {root}")
    print()

    if not (root / "run_server.py").exists():
        print("[错误] 找不到 run_server.py，请把启动游戏.exe 放在 Gamer 项目根目录。")
        input("按回车键退出...")
        return 1
    if not (web_dir / "package.json").exists():
        print("[错误] 找不到 web/package.json，请确认项目文件完整。")
        input("按回车键退出...")
        return 1

    if not run_checked([python_exe, "--version"], root, "Python 环境"):
        input("按回车键退出...")
        return 1
    if not run_checked(["node", "--version"], root, "Node.js 环境"):
        input("按回车键退出...")
        return 1
    if not run_checked([npm_command(), "--version"], root, "npm 环境"):
        input("按回车键退出...")
        return 1

    if "--check" in sys.argv:
        print("[OK] 启动器自检通过")
        return 0

    if not ensure_frontend_deps(root):
        input("按回车键退出...")
        return 1

    print()
    if is_port_open(BACKEND_PORT):
        print(f"[OK] 后端端口 {BACKEND_PORT} 已有服务，跳过重复启动")
    else:
        print("[启动] 后端服务器...")
        start_cmd_window("灾异志 后端服务器", f'"{python_exe}" run_server.py', root)
        if wait_for_port(BACKEND_PORT, 20):
            print(f"[OK] 后端已启动: http://localhost:{BACKEND_PORT}")
        else:
            print("[警告] 后端启动等待超时，请查看“灾异志 后端服务器”窗口")

    if is_port_open(FRONTEND_PORT):
        print(f"[OK] 前端端口 {FRONTEND_PORT} 已有服务，跳过重复启动")
    else:
        print("[启动] 前端服务器...")
        start_cmd_window("灾异志 前端服务器", f"{npm_command()} run dev", web_dir)
        if wait_for_port(FRONTEND_PORT, 30):
            print(f"[OK] 前端已启动: http://localhost:{FRONTEND_PORT}")
        else:
            print("[警告] 前端启动等待超时，请查看“灾异志 前端服务器”窗口")

    print()
    print("=" * 54)
    print("  启动完成")
    print("=" * 54)
    print(f"后端: http://localhost:{BACKEND_PORT}")
    print(f"游戏: http://localhost:{FRONTEND_PORT}")
    print()
    print("正在打开浏览器...")
    webbrowser.open(f"http://localhost:{FRONTEND_PORT}")
    print()
    print("关闭游戏时，请关闭弹出的后端和前端服务器窗口。")
    input("按回车键关闭启动器窗口，游戏服务会继续运行...")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n启动已取消")
        raise SystemExit(1)
