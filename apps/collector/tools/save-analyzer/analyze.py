from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "palworld-backup-analysis"
sys.path.insert(0, str(ROOT / "modern-tools"))

from palsav.gvas import GvasFile  # noqa: E402
from palsav.core import decompress_sav_to_gvas  # noqa: E402
from palsav.paltypes import (  # noqa: E402
    PALWORLD_CUSTOM_PROPERTIES,
    PALWORLD_TYPE_HINTS,
)


def load_sav(path: Path, custom_properties: dict | None = None) -> GvasFile:
    raw_gvas, _ = decompress_sav_to_gvas(path.read_bytes())
    return GvasFile.read(
        raw_gvas,
        PALWORLD_TYPE_HINTS,
        custom_properties or {},
    )


def describe(value, depth: int = 0, max_depth: int = 5):
    if depth >= max_depth:
        return type(value).__name__
    if isinstance(value, dict):
        return {
            str(key): describe(child, depth + 1, max_depth)
            for key, child in list(value.items())[:50]
        }
    if isinstance(value, list):
        return [describe(child, depth + 1, max_depth) for child in value[:3]]
    if isinstance(value, bytes):
        return f"bytes[{len(value)}]"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return repr(value)


def inspect_file(path: Path):
    save = load_sav(path, PALWORLD_CUSTOM_PROPERTIES)
    print(json.dumps(describe(save.dump()), ensure_ascii=False, indent=2))


def inspect_characters(path: Path):
    save = load_sav(path, PALWORLD_CUSTOM_PROPERTIES)
    characters = (
        save.properties["worldSaveData"]["value"]["CharacterSaveParameterMap"]["value"]
    )
    print(json.dumps(describe(characters[:2], max_depth=14), ensure_ascii=False, indent=2))


def scalar(prop, default=None):
    if not isinstance(prop, dict):
        return default
    value = prop.get("value", default)
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


def uuid_text(value) -> str:
    text = str(value)
    if "('" in text:
        return text.split("('", 1)[1].split("')", 1)[0]
    return text


def player_rows(path: Path):
    character_property = ".worldSaveData.CharacterSaveParameterMap.Value.RawData"
    save = load_sav(
        path,
        {character_property: PALWORLD_CUSTOM_PROPERTIES[character_property]},
    )
    characters = (
        save.properties["worldSaveData"]["value"]["CharacterSaveParameterMap"]["value"]
    )
    rows = []
    for entry in characters:
        uid = uuid_text(scalar(entry.get("key", {}).get("PlayerUId")))
        if uid == "00000000-0000-0000-0000-000000000000":
            continue
        parameter = (
            entry.get("value", {})
            .get("RawData", {})
            .get("value", {})
            .get("object", {})
            .get("SaveParameter", {})
            .get("value", {})
        )
        name = scalar(parameter.get("NickName"))
        level = scalar(parameter.get("Level"), 1)
        exp = scalar(parameter.get("Exp"), 0)
        rows.append(
            {
                "uid": uid,
                "privateId": hashlib.sha256(uid.encode()).hexdigest()[:16],
                "name": name,
                "level": level,
                "exp": exp,
                "characterId": scalar(parameter.get("CharacterID")),
                "lastOnline": scalar(parameter.get("LastOnlineDateTime")),
            }
        )
    return rows


def nested(mapping, *keys, default=None):
    value = mapping
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            return default
        value = value[key]
    return value


def container_id(prop) -> str | None:
    value = nested(prop, "value", "ID", "value")
    return uuid_text(value) if value is not None else None


def summed_map_count(prop) -> int:
    entries = nested(prop, "value", default=[])
    if not isinstance(entries, list):
        return 0
    total = 0
    for entry in entries:
        value = entry.get("value", 0) if isinstance(entry, dict) else 0
        if isinstance(value, dict):
            value = scalar(value, 0)
        try:
            total += int(value or 0)
        except (TypeError, ValueError):
            continue
    return total


def load_player_save(path: Path):
    save = load_sav(path)
    return save.properties["SaveData"]["value"]


def world_indexes(path: Path):
    custom_keys = [
        ".worldSaveData.CharacterSaveParameterMap.Value.RawData",
        ".worldSaveData.ItemContainerSaveData.Value.RawData",
        ".worldSaveData.ItemContainerSaveData.Value.Slots.Slots.RawData",
        ".worldSaveData.MapObjectSaveData",
        ".worldSaveData.GroupSaveDataMap",
        ".worldSaveData.GuildExtraSaveDataMap.Value.GuildItemStorage.RawData",
    ]
    save = load_sav(
        path,
        {key: PALWORLD_CUSTOM_PROPERTIES[key] for key in custom_keys},
    )
    world = save.properties["worldSaveData"]["value"]

    characters = []
    for entry in world["CharacterSaveParameterMap"]["value"]:
        key = entry.get("key", {})
        parameter = nested(
            entry,
            "value",
            "RawData",
            "value",
            "object",
            "SaveParameter",
            "value",
            default={},
        )
        characters.append(
            {
                "playerUid": uuid_text(scalar(key.get("PlayerUId"))),
                "instanceId": uuid_text(scalar(key.get("InstanceId"))),
                "ownerUid": uuid_text(scalar(parameter.get("OwnerPlayerUId"))),
                "containerId": uuid_text(
                    nested(
                        parameter,
                        "SlotId",
                        "value",
                        "ContainerId",
                        "value",
                        "ID",
                        "value",
                        default="",
                    )
                ),
                "slotIndex": scalar(
                    nested(parameter, "SlotId", "value", default={}).get("SlotIndex")
                ),
                "name": scalar(parameter.get("NickName")),
                "characterId": scalar(parameter.get("CharacterID")),
                "level": scalar(parameter.get("Level"), 1),
                "exp": scalar(parameter.get("Exp"), 0),
                "gender": nested(parameter, "Gender", "value", "value"),
                "passives": nested(
                    parameter, "PassiveSkillList", "value", "values", default=[]
                ),
            }
        )

    items = {}
    for entry in world["ItemContainerSaveData"]["value"]:
        cid = uuid_text(nested(entry, "key", "ID", "value", default=""))
        slots = nested(entry, "value", "Slots", "value", "values", default=[])
        parsed = []
        for slot in slots:
            raw = nested(slot, "RawData", "value", default={})
            count = int(raw.get("count", 0) or 0)
            static_id = nested(raw, "item", "static_id")
            if count > 0 and static_id:
                parsed.append({"id": static_id, "count": count})
        items[cid] = parsed

    storage_by_builder = {}
    storage_by_instance = {}
    map_objects = nested(
        world, "MapObjectSaveData", "value", "values", default=[]
    )
    for map_object in map_objects:
        raw = nested(map_object, "Model", "value", "RawData", "value", default={})
        instance_id = uuid_text(raw.get("instance_id", ""))
        builder_uid = uuid_text(raw.get("build_player_uid", ""))
        modules = nested(
            map_object,
            "ConcreteModel",
            "value",
            "ModuleMap",
            "value",
            default=[],
        )
        for module in modules:
            if (
                module.get("key")
                != "EPalMapObjectConcreteModelModuleType::ItemContainer"
            ):
                continue
            target_id = uuid_text(
                nested(
                    module,
                    "value",
                    "RawData",
                    "value",
                    "target_container_id",
                    default="",
                )
            )
            if not target_id:
                continue
            if builder_uid:
                storage_by_builder.setdefault(builder_uid, set()).add(target_id)
            if instance_id:
                storage_by_instance.setdefault(instance_id, set()).add(target_id)
    guild_memberships = {}
    for group in nested(world, "GroupSaveDataMap", "value", default=[]):
        if (
            nested(group, "value", "GroupType", "value", "value")
            != "EPalGroupType::Guild"
        ):
            continue
        guild_id = uuid_text(group.get("key", ""))
        members = nested(group, "value", "RawData", "value", "players", default=[])
        for member in members:
            player_uid = uuid_text(member.get("player_uid", ""))
            if player_uid:
                guild_memberships[player_uid] = guild_id

    guild_containers = {}
    for guild in nested(world, "GuildExtraSaveDataMap", "value", default=[]):
        guild_id = uuid_text(guild.get("key", ""))
        guild_container_id = uuid_text(
            nested(
                guild,
                "value",
                "GuildItemStorage",
                "value",
                "RawData",
                "value",
                "container_id",
                default="",
            )
        )
        if guild_id and guild_container_id:
            guild_containers[guild_id] = guild_container_id

    return (
        characters,
        items,
        storage_by_builder,
        storage_by_instance,
        guild_memberships,
        guild_containers,
    )


def rich_rows(snapshot: Path):
    (
        characters,
        item_containers,
        storage_by_builder,
        storage_by_instance,
        guild_memberships,
        guild_containers,
    ) = world_indexes(snapshot / "Level.sav")
    player_characters = {
        row["playerUid"]: row
        for row in characters
        if row["playerUid"] != "00000000-0000-0000-0000-000000000000"
    }
    pals_by_owner = {}
    for row in characters:
        if row["playerUid"] == "00000000-0000-0000-0000-000000000000":
            pals_by_owner.setdefault(row["ownerUid"], []).append(row)

    rows = []
    for player_path in sorted((snapshot / "Players").glob("*.sav")):
        if player_path.stem.lower().endswith("_dps"):
            continue
        uid = f"{player_path.stem[:8].lower()}-0000-0000-0000-000000000000"
        character = player_characters.get(uid)
        if not character:
            continue
        player = load_player_save(player_path)
        party_id = container_id(player.get("OtomoCharacterContainerId"))
        owned_pals = pals_by_owner.get(uid, [])
        party = sorted(
            (
                {
                    "id": pal["characterId"],
                    "name": pal["name"],
                    "level": pal["level"],
                    "gender": pal["gender"],
                    "passives": pal["passives"],
                    "slot": pal["slotIndex"],
                }
                for pal in owned_pals
                if pal["containerId"] == party_id
            ),
            key=lambda pal: pal["slot"] if pal["slot"] is not None else 999,
        )

        inventory_info = nested(player, "InventoryInfo", "value", default={})
        inventory_groups = {
            "main": container_id(inventory_info.get("CommonContainerId")),
            "key": container_id(inventory_info.get("EssentialContainerId")),
            "weapons": container_id(inventory_info.get("WeaponLoadOutContainerId")),
            "armor": container_id(inventory_info.get("PlayerEquipArmorContainerId")),
            "food": container_id(inventory_info.get("FoodEquipContainerId")),
        }
        category_totals = {}
        combined_items = {}
        occupied_slots = 0
        for category, cid in inventory_groups.items():
            container_items = item_containers.get(cid, [])
            category_totals[category] = sum(item["count"] for item in container_items)
            occupied_slots += len(container_items)
            for item in container_items:
                combined_items[item["id"]] = combined_items.get(item["id"], 0) + item["count"]

        personal_container_ids = {
            cid for cid in inventory_groups.values() if cid
        }
        storage_container_ids = set(storage_by_builder.get(uid, set()))
        building_instance_ids = nested(
            player,
            "RecordData",
            "value",
            "BuildingObjectMapObjectInstanceIds",
            "value",
            "values",
            default=[],
        )
        for instance_id in building_instance_ids:
            storage_container_ids.update(
                storage_by_instance.get(uuid_text(instance_id), set())
            )
        storage_container_ids.difference_update(personal_container_ids)
        guild_container_id = guild_containers.get(guild_memberships.get(uid))
        if guild_container_id:
            storage_container_ids.discard(guild_container_id)

        inventory_coins = int(combined_items.get("Money", 0) or 0)
        storage_coins = sum(
            int(item["count"] or 0)
            for cid in storage_container_ids
            for item in item_containers.get(cid, [])
            if item["id"] == "Money"
        )
        guild_coins = sum(
            int(item["count"] or 0)
            for item in item_containers.get(guild_container_id, [])
            if item["id"] == "Money"
        )

        levels = [int(pal["level"] or 1) for pal in owned_pals]
        species = {pal["characterId"] for pal in owned_pals if pal["characterId"]}
        record_data = nested(player, "RecordData", "value", default={})
        rows.append(
            {
                "userId": uid,
                "name": character["name"],
                "level": character["level"],
                "exp": character["exp"],
                "party": party,
                "inventory": {
                    "totalQuantity": sum(combined_items.values()),
                    "uniqueItems": len(combined_items),
                    "occupiedSlots": occupied_slots,
                    "categories": category_totals,
                    "topItems": [
                        {"id": item_id, "count": count}
                        for item_id, count in sorted(
                            combined_items.items(), key=lambda item: (-item[1], item[0])
                        )[:12]
                    ],
                    "coins": {
                        "inventoryCoins": inventory_coins,
                        "storageCoins": storage_coins,
                        "guildCoins": guild_coins,
                        "totalCoins": inventory_coins + storage_coins + guild_coins,
                    },
                },
                "pals": {
                    "owned": len(owned_pals),
                    "species": len(species),
                    "averageLevel": round(sum(levels) / len(levels), 1) if levels else 0,
                    "maxLevel": max(levels, default=0),
                    "highest": [
                        {
                            "id": pal["characterId"],
                            "name": pal["name"],
                            "level": pal["level"],
                        }
                        for pal in sorted(
                            owned_pals,
                            key=lambda pal: int(pal["level"] or 1),
                            reverse=True,
                        )[:5]
                    ],
                },
                "progress": {
                    "technologyPoints": int(scalar(player.get("TechnologyPoint"), 0) or 0),
                    "ancientTechnologyPoints": int(
                        scalar(player.get("bossTechnologyPoint"), 0) or 0
                    ),
                    "unlockedRecipes": len(
                        nested(
                            player,
                            "UnlockedRecipeTechnologyNames",
                            "value",
                            "values",
                            default=[],
                        )
                    ),
                    "completedQuests": len(
                        nested(
                            player,
                            "CompletedQuestArray_FullRelease",
                            "value",
                            "values",
                            default=[],
                        )
                    ),
                },
                "activity": {
                    "capturedPals": summed_map_count(record_data.get("PalCaptureCount")),
                    "craftedItems": summed_map_count(record_data.get("CraftItemCount")),
                    "fishingCount": summed_map_count(record_data.get("FishingCountMap")),
                    "condensedPals": summed_map_count(record_data.get("PalRankupCount")),
                    "butcheredPals": summed_map_count(record_data.get("PalButcherCount")),
                    "mutations": int(scalar(record_data.get("MutationCount"), 0) or 0),
                },
            }
        )
    return rows


def extract_rich_all(output: Path):
    events = []
    snapshots = sorted(path for path in (ROOT / "world").iterdir() if path.is_dir())
    for index, snapshot in enumerate(snapshots, start=1):
        timestamp = int(
            datetime.strptime(snapshot.name, "%Y.%m.%d-%H.%M.%S")
            .replace(tzinfo=timezone.utc)
            .timestamp()
            * 1000
        )
        rows = rich_rows(snapshot)
        events.extend({"timestamp": timestamp, **row} for row in rows)
        print(f"[{index}/{len(snapshots)}] {snapshot.name}: {len(rows)} players")
    output.write_text(
        json.dumps(
            {"type": "rich-history", "source": "world-backup", "events": events},
            ensure_ascii=True,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(events)} rich events to {output}")


def append_rich(snapshot: Path, output: Path):
    payload = json.loads(output.read_text(encoding="utf-8"))
    timestamp = int(
        datetime.strptime(snapshot.name, "%Y.%m.%d-%H.%M.%S")
        .replace(tzinfo=timezone.utc)
        .timestamp()
        * 1000
    )
    events = [
        event
        for event in payload.get("events", [])
        if int(event.get("timestamp", -1)) != timestamp
    ]
    events.extend({"timestamp": timestamp, **row} for row in rich_rows(snapshot))
    events.sort(key=lambda event: (int(event["timestamp"]), event["userId"]))
    payload["events"] = events
    output.write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {len(events)} rich events to {output}")


def extract_rich_snapshot(snapshot: Path, output: Path):
    timestamp = int(
        datetime.strptime(snapshot.name, "%Y.%m.%d-%H.%M.%S")
        .replace(tzinfo=timezone.utc)
        .timestamp()
        * 1000
    )
    events = [
        {"timestamp": timestamp, **row}
        for row in rich_rows(snapshot)
    ]
    output.write_text(
        json.dumps(
            {"type": "rich-history", "source": "live-world-backup", "events": events},
            ensure_ascii=True,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(events)} rich events to {output}")


def inspect_players(path: Path):
    print(json.dumps(player_rows(path), ensure_ascii=False, indent=2))


def inspect_player_data(path: Path):
    print(
        json.dumps(
            describe(load_player_save(path), max_depth=12),
            ensure_ascii=False,
            indent=2,
        )
    )


def inspect_world_collection(path: Path, key: str, custom_keys: list[str]):
    selected = {
        custom_key: PALWORLD_CUSTOM_PROPERTIES[custom_key]
        for custom_key in custom_keys
    }
    save = load_sav(path, selected)
    collection = save.properties["worldSaveData"]["value"][key]["value"]
    print(json.dumps(describe(collection[:2], max_depth=16), ensure_ascii=False, indent=2))


def extract_all(output: Path):
    events = []
    snapshots = sorted(path for path in (ROOT / "world").iterdir() if path.is_dir())
    for index, snapshot in enumerate(snapshots, start=1):
        timestamp = int(
            datetime.strptime(snapshot.name, "%Y.%m.%d-%H.%M.%S")
            .replace(tzinfo=timezone.utc)
            .timestamp()
            * 1000
        )
        rows = player_rows(snapshot / "Level.sav")
        for row in rows:
            events.append(
                {
                    "timestamp": timestamp,
                    "userId": row["uid"],
                    "name": row["name"],
                    "level": row["level"],
                    "exp": row["exp"],
                    "source": "world-backup",
                }
            )
        print(f"[{index}/{len(snapshots)}] {snapshot.name}: {len(rows)} players")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "type": "level-history",
                "source": "world-backup",
                "events": events,
            },
            ensure_ascii=True,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(events)} events to {output}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", type=Path)
    parser.add_argument("--inspect-characters", type=Path)
    parser.add_argument("--inspect-players", type=Path)
    parser.add_argument("--inspect-player-data", type=Path)
    parser.add_argument("--inspect-record-keys", type=Path)
    parser.add_argument("--inspect-fishing-counts", type=Path)
    parser.add_argument("--extract-all", type=Path)
    parser.add_argument("--inspect-items", type=Path)
    parser.add_argument("--inspect-pal-containers", type=Path)
    parser.add_argument("--extract-rich-all", type=Path)
    parser.add_argument("--inspect-rich", type=Path)
    parser.add_argument("--inspect-activity", type=Path)
    parser.add_argument("--inspect-coins", type=Path)
    parser.add_argument("--inspect-guilds", type=Path)
    parser.add_argument("--append-rich", nargs=2, type=Path, metavar=("SNAPSHOT", "OUTPUT"))
    parser.add_argument(
        "--extract-rich-snapshot",
        nargs=2,
        type=Path,
        metavar=("SNAPSHOT", "OUTPUT"),
    )
    args = parser.parse_args()
    if args.inspect:
        inspect_file(args.inspect)
        return
    if args.inspect_characters:
        inspect_characters(args.inspect_characters)
        return
    if args.inspect_players:
        inspect_players(args.inspect_players)
        return
    if args.inspect_player_data:
        inspect_player_data(args.inspect_player_data)
        return
    if args.inspect_record_keys:
        record_data = nested(
            load_player_save(args.inspect_record_keys),
            "RecordData",
            "value",
            default={},
        )
        print(json.dumps(sorted(record_data.keys()), ensure_ascii=False, indent=2))
        return
    if args.inspect_fishing_counts:
        fishing_counts = nested(
            load_player_save(args.inspect_fishing_counts),
            "RecordData",
            "value",
            "FishingCountMap",
            "value",
            default=[],
        )
        print(json.dumps(describe(fishing_counts, max_depth=8), ensure_ascii=False, indent=2))
        return
    if args.inspect_activity:
        print(
            json.dumps(
                [
                    {"name": row["name"], **row["activity"]}
                    for row in rich_rows(args.inspect_activity)
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    if args.extract_all:
        extract_all(args.extract_all)
        return
    if args.inspect_items:
        inspect_world_collection(
            args.inspect_items,
            "ItemContainerSaveData",
            [
                ".worldSaveData.ItemContainerSaveData.Value.RawData",
                ".worldSaveData.ItemContainerSaveData.Value.Slots.Slots.RawData",
            ],
        )
        return
    if args.inspect_pal_containers:
        inspect_world_collection(
            args.inspect_pal_containers,
            "CharacterContainerSaveData",
            [".worldSaveData.CharacterContainerSaveData.Value.Slots.Slots.RawData"],
        )
        return
    if args.extract_rich_all:
        extract_rich_all(args.extract_rich_all)
        return
    if args.inspect_rich:
        print(json.dumps(rich_rows(args.inspect_rich), ensure_ascii=False, indent=2))
        return
    if args.inspect_coins:
        print(
            json.dumps(
                [
                    {"name": row["name"], **row["inventory"]["coins"]}
                    for row in rich_rows(args.inspect_coins)
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    if args.inspect_guilds:
        inspect_world_collection(
            args.inspect_guilds,
            "GroupSaveDataMap",
            [".worldSaveData.GroupSaveDataMap"],
        )
        return
    if args.append_rich:
        append_rich(args.append_rich[0], args.append_rich[1])
        return
    if args.extract_rich_snapshot:
        extract_rich_snapshot(args.extract_rich_snapshot[0], args.extract_rich_snapshot[1])
        return
    raise SystemExit("Pass --inspect <sav>")


if __name__ == "__main__":
    main()
