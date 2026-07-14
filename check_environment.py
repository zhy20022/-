"""
环境检查脚本
检查游戏运行所需的环境和依赖
"""

import sys
import os

def check_python():
    """检查 Python 版本"""
    print("=" * 50)
    print("1. 检查 Python 环境")
    print("=" * 50)
    version = sys.version_info
    print(f"Python 版本: {version.major}.{version.minor}.{version.micro}")
    if version.major >= 3 and version.minor >= 8:
        print("[OK] Python 版本符合要求（需要 3.8+）")
        return True
    else:
        print("[X] Python 版本过低，需要 3.8 或更高版本")
        return False

def check_python_packages():
    """检查 Python 依赖包"""
    print("\n" + "=" * 50)
    print("2. 检查 Python 依赖包")
    print("=" * 50)
    
    required_packages = {
        'flask': 'Flask',
        'flask_cors': 'Flask-CORS',
        'flask_socketio': 'Flask-SocketIO',
        'sqlalchemy': 'SQLAlchemy',
        'psycopg2': 'psycopg2-binary',
        'dotenv': 'python-dotenv',
        'apscheduler': 'APScheduler',
        'pytz': 'pytz'
    }
    
    missing = []
    for module, package_name in required_packages.items():
        try:
            __import__(module)
            print(f"[OK] {package_name} 已安装")
        except ImportError:
            print(f"[X] {package_name} 未安装")
            missing.append(package_name)
    
    if missing:
        print(f"\n缺少以下包: {', '.join(missing)}")
        print("请运行: pip install -r requirements.txt")
        return False
    return True

def check_database():
    """检查数据库连接"""
    print("\n" + "=" * 50)
    print("3. 检查数据库连接")
    print("=" * 50)
    
    try:
        from src.database import init_database, get_database
        import os
        
        # 获取数据库 URL
        database_url = os.getenv(
            'DATABASE_URL',
            'postgresql://postgres:postgres@localhost:5432/gamedb'
        )
        print(f"数据库 URL: {database_url.split('@')[1] if '@' in database_url else '默认配置'}")
        
        # 尝试初始化数据库
        print("正在连接数据库...")
        init_database(database_url)
        db = get_database()
        
        # 尝试创建会话
        session = db.get_session()
        session.close()
        
        print("[OK] 数据库连接成功")
        print("[OK] 数据表已创建/已存在")
        return True
        
    except Exception as e:
        print(f"[X] 数据库连接失败: {str(e)}")
        print("\n可能的原因：")
        print("1. PostgreSQL 服务未启动")
        print("2. 数据库 'gamedb' 不存在（需要手动创建）")
        print("3. 用户名或密码错误")
        print("4. 端口被占用或无法访问")
        print("\n解决方案：")
        print("1. 启动 PostgreSQL 服务")
        print("2. 创建数据库: CREATE DATABASE gamedb;")
        print("3. 检查 .env 文件中的 DATABASE_URL 配置")
        return False

def check_nodejs():
    """检查 Node.js 和 npm"""
    print("\n" + "=" * 50)
    print("4. 检查 Node.js 环境")
    print("=" * 50)
    
    import subprocess
    
    try:
        result = subprocess.run(['node', '--version'], 
                              capture_output=True, 
                              text=True, 
                              timeout=5)
        if result.returncode == 0:
            print(f"[OK] Node.js 已安装: {result.stdout.strip()}")
            
            # 检查 npm
            result = subprocess.run(['npm', '--version'], 
                                  capture_output=True, 
                                  text=True, 
                                  timeout=5)
            if result.returncode == 0:
                print(f"[OK] npm 已安装: {result.stdout.strip()}")
                return True
            else:
                print("[X] npm 未安装或不在 PATH 中")
                return False
        else:
            print("[X] Node.js 未安装或不在 PATH 中")
            return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[X] Node.js 未安装或不在 PATH 中")
        print("\n请安装 Node.js:")
        print("1. 访问: https://nodejs.org/")
        print("2. 下载并安装 LTS 版本")
        print("3. 安装后重启命令行窗口")
        return False

def check_frontend_dependencies():
    """检查前端依赖"""
    print("\n" + "=" * 50)
    print("5. 检查前端依赖")
    print("=" * 50)
    
    web_dir = os.path.join(os.path.dirname(__file__), 'web')
    node_modules = os.path.join(web_dir, 'node_modules')
    
    if os.path.exists(node_modules):
        print("[OK] 前端依赖已安装 (node_modules 存在)")
        return True
    else:
        print("[X] 前端依赖未安装")
        print(f"请运行: cd web && npm install")
        return False

def main():
    """主函数"""
    print("\n" + "=" * 50)
    print("游戏环境检查")
    print("=" * 50 + "\n")
    
    results = {
        'Python': check_python(),
        'Python 包': check_python_packages(),
        '数据库': check_database(),
        'Node.js': check_nodejs(),
        '前端依赖': check_frontend_dependencies() if check_nodejs() else False
    }
    
    print("\n" + "=" * 50)
    print("检查结果总结")
    print("=" * 50)
    
    all_passed = True
    for name, passed in results.items():
        status = "[OK] 通过" if passed else "[X] 失败"
        print(f"{name}: {status}")
        if not passed:
            all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("[OK] 所有检查通过！可以启动游戏了")
        print("\n启动步骤：")
        print("1. 第一个窗口: python run_server.py")
        print("2. 第二个窗口: cd web && npm run dev")
        print("3. 浏览器访问: http://localhost:5173/")
    else:
        print("[X] 部分检查未通过，请根据上述提示修复问题")
    print("=" * 50 + "\n")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n检查已取消")
    except Exception as e:
        print(f"\n检查过程中出错: {str(e)}")
        import traceback
        traceback.print_exc()

