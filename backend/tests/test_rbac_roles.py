from __future__ import annotations

from app.extensions import db
from app.models import Permission, PermissionCode, Role, User


def _token(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["access_token"]


def test_admin_can_crud_custom_role(client, app):
    with app.app_context():
        admin_role = Role.query.filter_by(name="admin").one()
        admin = User(username="root", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        admin.set_password("rootpass123")
        admin.roles.append(admin_role)
        db.session.add(admin)
        db.session.commit()

    token = _token(client, "root", "rootpass123")
    headers = {"Authorization": f"Bearer {token}"}

    permissions_response = client.get("/admin/permissions", headers=headers)
    assert permissions_response.status_code == 200
    codes = {item["code"] for item in permissions_response.get_json()["items"]}
    assert PermissionCode.ROLE_MANAGE.value in codes
    assert PermissionCode.FILE_READ.value in codes

    create_role = client.post(
        "/admin/roles",
        json={
            "name": "media_reviewer",
            "description": "Can browse files and media",
            "permission_codes": [PermissionCode.FILE_READ.value, PermissionCode.MEDIA_VIEW.value],
        },
        headers=headers,
    )
    assert create_role.status_code == 201
    role_id = create_role.get_json()["role"]["id"]

    update_role = client.patch(
        f"/admin/roles/{role_id}",
        json={
            "description": "Can browse and edit media",
            "permission_codes": [
                PermissionCode.FILE_READ.value,
                PermissionCode.MEDIA_VIEW.value,
                PermissionCode.FILE_WRITE.value,
            ],
        },
        headers=headers,
    )
    assert update_role.status_code == 200
    updated_codes = {item["code"] for item in update_role.get_json()["role"]["permissions"]}
    assert PermissionCode.FILE_WRITE.value in updated_codes

    delete_role = client.delete(f"/admin/roles/{role_id}", headers=headers)
    assert delete_role.status_code == 200


def test_user_manage_without_role_manage_cannot_assign_roles(client, app):
    with app.app_context():
        user_manage_perm = Permission.query.filter_by(code=PermissionCode.USER_MANAGE.value).one()
        manager_role = Role(name="user_manager_only", description="Can manage users but not roles")
        manager_role.permissions = [user_manage_perm]
        db.session.add(manager_role)
        db.session.flush()

        manager = User(username="manager", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        manager.set_password("managerpass123")
        manager.roles.append(manager_role)
        db.session.add(manager)
        db.session.commit()

    token = _token(client, "manager", "managerpass123")
    headers = {"Authorization": f"Bearer {token}"}

    forbidden = client.post(
        "/admin/users",
        json={
            "username": "newbie",
            "password": "newbiepass123",
            "role_names": ["admin"],
        },
        headers=headers,
    )
    assert forbidden.status_code == 403

    allowed = client.post(
        "/admin/users",
        json={
            "username": "newbie",
            "password": "newbiepass123",
        },
        headers=headers,
    )
    assert allowed.status_code == 201
    created_user = allowed.get_json()["user"]
    created_roles = {role["name"] for role in created_user["roles"]}
    assert created_roles == {"user"}


def test_read_only_user_cannot_create_folder(client, app):
    with app.app_context():
        file_read_perm = Permission.query.filter_by(code=PermissionCode.FILE_READ.value).one()
        readonly_role = Role(name="readonly", description="Read-only access")
        readonly_role.permissions = [file_read_perm]
        db.session.add(readonly_role)
        db.session.flush()

        readonly_user = User(username="readonly-user", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        readonly_user.set_password("readonlypass123")
        readonly_user.roles.append(readonly_role)
        db.session.add(readonly_user)
        db.session.commit()

    token = _token(client, "readonly-user", "readonlypass123")
    headers = {"Authorization": f"Bearer {token}"}

    create_folder = client.post("/files/folder", json={"name": "docs", "parent_id": None}, headers=headers)
    assert create_folder.status_code == 403
