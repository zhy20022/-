"""
游戏一键启动器
自动检查环境并启动后端和前端服务器
"""

import os
import sys
import subprocess
import time
import webbrowser
from pathlib import Path

def check_python():
    """检查 Python"""
    try:
        result = subprocess.run(['python', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print(f"[OK] Python: {result.stdout.strip()}")
            return True
    except:
        pass
    print("[X] 未找到 Python，请先安装 Python 3.8+")
    return False

def check_nodejs():
    """检查 Node.js"""
    try:
        result = subprocess.run(['node', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print(f"[OK] Node.js: {result.stdout.strip()}")
            return True
    except:
        pass
    print("[X] 未找到 Node.js，请先安装 Node.js")
    print("    下载地址: https://nodejs.org/")
    return False

def check_database():
    """检查数据库连接（可选，不阻止启动）"""
    try:
        from src.database import init_database, get_database
        import os
        database_url = os.getenv(
            'DATABASE_URL',
            'postgresql://postgres:postgres@localhost:5432/gamedb'
        )
        init_database(database_url)
        db = get_database()
        session = db.get_session()
        session.close()
        print("[OK] 数据库连接成功")
        return True
    except Exception as e:
        print(f"[警告] 数据库连接失败: {str(e)[:50]}...")
        print("       游戏可能无法正常运行，请检查 PostgreSQL 是否已启动")
        return False

def install_frontend_deps():
    """安装前端依赖"""
    web_dir = Path('web')
    node_modules = web_dir / 'node_modules'
    
    if not node_modules.exists():
        print("[提示] 正在安装前端依赖（首次运行需要一些时间）...")
        try:
            subprocess.run(['npm', 'install'], 
                         cwd=web_dir, 
                         check=True,
                         timeout=300)
            print("[OK] 前端依赖安装完成")
        except subprocess.TimeoutExpired:
            print("[错误] 安装超时，请手动运行: cd web && npm install")
            return False
        except subprocess.CalledProcessError:
            print("[错误] 安装失败，请手动运行: cd web && npm install")
            return False
    else:
        print("[OK] 前端依赖已安装")
    
    return True

def start_backend():
    """启动后端服务器"""
    print("\n[启动] 正在启动后端服务器...")
    try:
        # 使用新窗口启动后端
        if sys.platform == 'win32':
            subprocess.Popen(
                ['python', 'run_server.py'],
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        else:
            subprocess.Popen(['python', 'run_server.py'])
        print("[OK] 后端服务器已启动 (http://localhost:5000)")
        time.sleep(3)  # 等待后端启动
        return True
    except Exception as e:
        print(f"[错误] 后端启动失败: {str(e)}")
        return False

def start_frontend():
    """启动前端服务器"""
    print("[启动] 正在启动前端服务器...")
    try:
        web_dir = Path('web')
        # 使用新窗口启动前端
        if sys.platform == 'win32':
            subprocess.Popen(
                ['npm', 'run', 'dev'],
                cwd=web_dir,
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        else:
            subprocess.Popen(['npm', 'run', 'dev'], cwd=web_dir)
        print("[OK] 前端服务器已启动 (http://localhost:3000)")
        time.sleep(5)  # 等待前端启动
        return True
    except Exception as e:
        print(f"[错误] 前端启动失败: {str(e)}")
        return False

def main():
    """主函数"""
    print("=" * 50)
    print("  灾异志 - 一键启动器")
    print("=" * 50)
    print()
    
    # 环境检查
    print("正在检查环境...")
    if not check_python():
        input("\n按回车键退出...")
        return
    
    if not check_nodejs():
        input("\n按回车键退出...")
        return
    
    check_database()  # 数据库检查不阻止启动
    
    print()
    
    # 安装前端依赖
    if not install_frontend_deps():
        input("\n按回车键退出...")
        return
    
    print()
    
    # 启动服务
    if not start_backend():
        input("\n按回车键退出...")
        return
    
    if not start_frontend():
        input("\n按回车键退出...")
        return
    
    print()
    print("=" * 50)
    print("  启动完成！")
    print("=" * 50)
    print()
    print("后端服务器: http://localhost:5000")
    print("前端游戏: http://localhost:3000")
    print()
    print("浏览器将自动打开游戏页面...")
    print()
    print("[提示] 游戏已启动，请勿关闭后端和前端服务器窗口")
    print("[提示] 关闭游戏时，请关闭后端和前端服务器窗口")
    print()
    
    # 等待一下让服务器完全启动
    time.sleep(3)
    
    # 自动打开浏览器
    try:
        webbrowser.open('http://localhost:3000')
    except:
        print("无法自动打开浏览器，请手动访问: http://localhost:3000")
    
    input("\n按回车键退出启动器（游戏将继续运行）...")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n启动已取消")
    except Exception as e:
        print(f"\n[错误] 启动失败: {str(e)}")
        import traceback
        traceback.print_exc()
        input("\n按回车键退出...")

