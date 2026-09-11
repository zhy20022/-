"""Compare authored content with the actual online worker loadout; no gameplay mutation."""
import contextlib
import hashlib
import io
import json
import random
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.nest_battle_worker import character_from_snapshot
from src.combat.battle_unit import BattleUnit
from src.skills.skill_config import SkillConfig
from scripts.build_character_content import extract_skills, read_docx_paragraphs


def main():
    catalog = json.loads((ROOT / "data/content/characters.json").read_text(encoding="utf-8-sig"))
    rows = []
    for definition in catalog["characters"]:
        doc = ROOT.parent / definition["source"]
        word_text = ""
        word_skills = {}
        source_hash = None
        if doc.exists():
            source_hash = hashlib.sha256(doc.read_bytes()).hexdigest()
            with zipfile.ZipFile(doc) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                word_text = "\n".join("".join(p.itertext()) for p in xml.findall(".//w:p", ns))
            word_skills = {skill["slot"]: skill for skill in extract_skills(read_docx_paragraphs(doc))}
        with contextlib.redirect_stdout(io.StringIO()):
            character = character_from_snapshot({
                "id": definition["id"], "characterConfigId": definition["id"], "level": 1,
                "professionType": definition["professionType"], "attributeType": definition["attributeType"],
                "skillSlots": {"lastBattleGrowth": {"afterLevel": 1}}, "equipment": {},
            })
            unit = BattleUnit(character)
            SkillConfig.setup_battle_skills(character, unit.skill_manager, character.skill_learning_system)
        manager = unit.skill_manager
        skills = manager.low_tier_slots.skills + manager.mid_tier_slots.skills + manager.high_tier_slots.skills
        runtime = [{"id": skill.skill_id, "name": skill.name, "tier": skill.skill_tier.value} for skill in skills]
        sequence = []
        random.seed(definition["id"])
        for second in range(1, 31):
            skill = manager.get_next_skill(second)
            sequence.append(skill.name if skill else None)
            manager.update(1)
        for skill in definition["skills"]:
            text = skill["effect"]
            overlapping = [entry["id"] for entry in runtime if entry["name"] == skill["name"]]
            rows.append({
                "characterId": definition["id"], "character": definition["name"], "attribute": definition["attributeName"],
                "slot": skill["slot"], "skill": skill["name"], "description": text, "notes": skill.get("notes", []),
                "wordSource": definition["source"], "wordExists": doc.exists(), "wordSha256": source_hash,
                "descriptionFoundInCurrentWord": bool(word_text) and text == word_skills.get(skill["slot"], {}).get("effect"),
                "currentWordDescription": word_skills.get(skill["slot"], {}).get("effect"),
                "runtimeSkills": runtime, "thirtyCastSelectionProbe": sequence,
                "matchingRuntimeNames": overlapping,
                "status": "name_overlap_requires_effect_review" if overlapping else "authored_skill_not_in_default_runtime",
                "implementation": "src/skills/skill_config.py -> src/skills/skill_database.py (attribute fallback)",
                "test": "tests/test_character_skill_audit.py",
                "growthMetadataRegression": "passed" if len(runtime) == 9 else "failed",
                "effectVerification": "not_verified",
            })
    summary = {
        "characters": len(catalog["characters"]), "skills": len(rows),
        "missingDefaultRuntimeMapping": sum(not row["matchingRuntimeNames"] for row in rows),
        "wordDescriptionsNeedingReview": sum(not row["descriptionFoundInCurrentWord"] for row in rows),
        "scope": "Default online loadout and 30 skill selections, not a numerical combat or full effect simulation",
    }
    destination = ROOT / "docs/character-skill-execution-audit.json"
    destination.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# 64角色技能执行核对表", "",
        "本表由实际正式战斗入口装载技能后生成。技能选择探针不代表伤害、治疗或特殊机制已经验收。",
        "描述来自游戏内容配置，并逐项检查是否仍包含于当前Word文本。未匹配时以Word复核为准，不能据此自动改写技能。",
        "本轮先修复成长记录导致技能清空的问题；专属技能未接入项不标记为完成。", "",
        f"角色：{summary['characters']}；技能：{summary['skills']}；默认实战未映射：{summary['missingDefaultRuntimeMapping']}；需要核对Word描述：{summary['wordDescriptionsNeedingReview']}。",
        "", "## 核对结果",
    ]
    for definition in catalog["characters"]:
        selected = [row for row in rows if row["characterId"] == definition["id"]]
        lines += ["", f"### {definition['name']}（{definition['attributeName']}）", "",
                  f"Word：{definition['source']}",
                  "实际默认技能：" + "、".join(entry["name"] for entry in selected[0]["runtimeSkills"]), "",
                  "| 技能 | 描述 | 代码对应 | 测试结果 |", "| --- | --- | --- | --- |"]
        for row in selected:
            description = row["description"].replace("|", "／").replace("\n", "<br>")
            match = "名称重合，效果待人工核对" if row["matchingRuntimeNames"] else "未映射；目前执行属性通用技能"
            word = "Word描述匹配" if row["descriptionFoundInCurrentWord"] else "Word描述待复核"
            lines.append(f"| {row['slot']} {row['skill']} | {description} | {match} | 技能装载回归{row['growthMetadataRegression']}；{word}；特殊效果未验收 |")
    (ROOT / "docs/character-skill-execution-audit.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == "__main__":
    main()
