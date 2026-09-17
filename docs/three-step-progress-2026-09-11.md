# 三步推进验收记录

## 1 注册并发

- 注册账号及玩家档案改为同一事务；密码哈希在事务前计算。
- 同名并发唯一键冲突返回409；失败不留下孤立账号。
- 网络类错误增加只含错误类型和代码的诊断，并返回503，不泄漏密码、SQL参数或连接串。
- 本地实际PostgreSQL验收：6个不同账号并发成功；6个同名请求为1成功+5冲突；注入档案写入故障后账号回滚。
- 线上版本6fa41f981d680069e40ea3cf448bda88e4bd933b的GitHub运行34575886087全部通过：6账号、125请求、每项6次重复请求。
- p95约15.6秒，说明正确性验收通过不代表容量和响应速度达标。旧日志只有AggregateError，无法倒推出原先每次网络错误的完整根因。
- 后续47f69ce复测再次失败；新增诊断明确捕获ETIMEDOUT及ENETUNREACH，说明单次通过不足以证明连接稳定。
- 第二轮修复：地址自动选择的单次尝试等待延长为2秒；注册仅在取得连接、事务尚未开始前进行最多3次有限重试，不重放事务或提交结果不明的写入。
- Node地址尝试及AggregateError行为参考：https://nodejs.org/api/net.html#netsetdefaultautoselectfamilyattempttimeoutvalue
- 连接重试单测：node scripts/test-acquire-connection.mjs，验证重试上限、资源释放及认证错误不重试。
- 第二轮线上复测：e404e0ddfb5c6bbdd45ea9f2c0d8016c240b996b的GitHub运行34578510312通过构建、公开验收及并发验收；这是一次正确性回归，不代表长期稳定性或容量上限。

复测：server-nest目录运行 node scripts/e2e-registration.mjs，E2E_DATABASE_URL必须指向隔离本地库。

## 2 真实Boss浏览器验收

- 运行真实Nest、Python计算进程、隔离PostgreSQL及真实浏览器；不伪造战斗HTTP响应。
- 覆盖8属性的五人、二十人、全服Boss挑战，共24个入口。
- 每个入口检查1280及390像素视口，共48个画面；另完成24次浏览器结算并核对数据库胜负、时长及伤害。
- 为缩短等待，只调整隔离库测试票据的serverTime；血量、技能、胜负及奖励均取真实计算结果。
- 修复小怪被标为Boss的问题：使用引擎spawn_category，不再按整个副本类型推断单位身份。
- 范围：所有入口的代表性随机组合，不代表每个随机组合、每个阶段和所有角色搭配已经穷举。
- 跨账号房间及全服赛季仍不在这项验收范围。

复测：前端启动于127.0.0.1:3017；server-nest目录运行 node scripts/e2e-boss-browser.mjs。设置本地E2E_DATABASE_URL，Playwright通过NODE_PATH加载或安装在测试环境中；默认使用msedge，可通过PLAYWRIGHT_CHANNEL覆盖。

## 3 角色技能执行核对起步

- 清单：character-skill-execution-audit.md及同名JSON。
- 64角色192技能描述与当前Word一致。
- 默认实战执行属性通用技能，没有装载这192个专属技能；清单明确标记未映射，不能视作完整实现或平衡验收。
- 复现并修复lastBattleGrowth元数据误判为技能配置：修复前64角色下一场默认技能全部变0，修复后均恢复9技能；显式配置不受影响。
- 30次技能选择仅为装载/循环探针，不是伤害、治疗、印记触发的完整模拟。
- 回归：python -m pytest tests/test_character_skill_audit.py tests/test_authored_monsters.py -q，21项测试及128子测试通过。
- 下一步：按角色逐项实现专属技能，先明确角色3技能与现有9槽的映射，再验证施法计数、叠层、护盾、复活和触发条件；不能仅替换通用技能名字。

重新生成核对表：python scripts/audit_character_skill_execution.py。

## 2026-09-14 技能存档恢复回归

- 发现正式Nest保存的配置位于skillSlots.skillSlots内，战斗装载器此前只识别顶层low/mid/high，导致保存配置被默认配置替代。
- 兼容skillSlots和skill_slots两种嵌套字段，同时保留旧版顶层配置及仅成长元数据的默认装载逻辑。
- 使用反转槽位顺序的配置防止默认配置掩盖问题：修复前64角色两种格式共128个子用例失败，修复后通过。
- Python回归：22项测试、256个子用例通过。Nest构建及真实worker的SINGLE、SQUAD、TEAM、SERVER_BOSS四类战斗回归通过。
- 本轮为本地修复，尚未部署。未新增192个专属技能的执行效果。
- 待确认：游戏设定.txt第18至32行规定3个ABC技能配置9槽、按底中高梯度随机轮换；此前角色模拟使用固定1→2→3循环。需要确认正式战斗采用哪种规则，再实现专属技能映射，避免改变印记和爆发节奏。

后续用户已确认正式战斗采用ABC可重复9槽、底中高随机轮换。本轮已实现规则接管，并接入玉尘子3个专属技能，剩余189个待接入；最新范围、回归与未完成项见character-abc-progress-2026-09-14.md，以上“待确认”和192个全未接入为此前历史记录。
