"""
游戏状态诊断脚本
检查前端、后端和数据库的运行状态
"""

import sys
import socket
import subprocess
import os
import urllib.request
import urllib.error

def check_port(host, port):
    """检查端口是否开放"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except:
        return False

def check_backend():
    """检查后端服务器"""
    print("\n" + "="*50)
    print("检查后端服务器 (端口 5000)")
    print("="*50)
    
    if check_port('localhost', 5000):
        print("[OK] 端口 5000 已开放")
        try:
            req = urllib.request.Request('http://localhost:5000/api/player/info')
            with urllib.request.urlopen(req, timeout=3) as response:
                status_code = response.getcode()
                print(f"[OK] 后端API可访问 (状态码: {status_code})")
                return True
        except Exception as e:
            print(f"[错误] 后端API无法访问: {e}")
            return False
    else:
        print("[错误] 端口 5000 未开放")
        print("  请确认后端服务器已启动：python run_server.py")
        return False

def check_frontend():
    """检查前端服务器"""
    print("\n" + "="*50)
    print("检查前端服务器 (端口 3000)")
    print("="*50)
    
    if check_port('localhost', 3000):
        print("[OK] 端口 3000 已开放")
        try:
            req = urllib.request.Request('http://localhost:3000')
            with urllib.request.urlopen(req, timeout=3) as response:
                status_code = response.getcode()
                print(f"[OK] 前端页面可访问 (状态码: {status_code})")
                return True
        except Exception as e:
            print(f"[错误] 前端页面无法访问: {e}")
            return False
    else:
        print("[错误] 端口 3000 未开放")
        print("  请确认前端服务器已启动：cd web && npm run dev")
        return False

def check_database():
    """检查数据库连接"""
    print("\n" + "="*50)
    print("检查数据库连接")
    print("="*50)
    
    try:
        from src.database import Database
        db = Database()
        if db.engine:
            # 尝试执行简单查询
            from sqlalchemy import text
            with db.engine.connect() as conn:
                result = conn.execute(text("SELECT 1"))
                result.fetchone()
            print("[OK] 数据库连接正常")
            return True
        else:
            print("[错误] 数据库引擎未初始化")
            return False
    except Exception as e:
        print(f"[错误] 数据库连接失败: {e}")
        print("  提示: 如果是PostgreSQL，请确认服务已启动")
        print("  如果是SQLite，会自动创建数据库文件")
        return False

def check_processes():
    """检查相关进程"""
    print("\n" + "="*50)
    print("检查相关进程")
    print("="*50)
    
    # Windows下检查进程
    if sys.platform == 'win32':
        try:
            # 检查Python进程
            result = subprocess.run(
                ['tasklist', '/FI', 'IMAGENAME eq python.exe', '/FO', 'CSV'],
                capture_output=True,
                text=True,
                encoding='gbk'
            )
            python_count = result.stdout.count('python.exe')
            print(f"[信息] 找到 {python_count} 个Python进程")
            
            # 检查Node进程
            result = subprocess.run(
                ['tasklist', '/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV'],
                capture_output=True,
                text=True,
                encoding='gbk'
            )
            node_count = result.stdout.count('node.exe')
            print(f"[信息] 找到 {node_count} 个Node进程")
            
        except Exception as e:
            print(f"[错误] 无法检查进程: {e}")

def main():
    print("\n" + "="*50)
    print("灾异志 - 游戏状态诊断")
    print("="*50)
    
    backend_ok = check_backend()
    frontend_ok = check_frontend()
    database_ok = check_database()
    check_processes()
    
    print("\n" + "="*50)
    print("诊断总结")
    print("="*50)
    
    if backend_ok and frontend_ok and database_ok:
        print("[OK] 所有服务运行正常！")
        print("\n请访问游戏：http://localhost:3000")
    else:
        print("[问题] 发现问题：")
        if not backend_ok:
            print("  - 后端服务器未正常运行")
            print("    解决方法: 运行 python run_server.py")
        if not frontend_ok:
            print("  - 前端服务器未正常运行")
            print("    解决方法: 运行 cd web && npm run dev")
        if not database_ok:
            print("  - 数据库连接异常")
            print("    解决方法: 检查数据库服务是否启动")
    
    print("\n" + "="*50)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n诊断已取消")
    except Exception as e:
        print(f"\n诊断过程中出错: {e}")
        import traceback
        traceback.print_exc()

