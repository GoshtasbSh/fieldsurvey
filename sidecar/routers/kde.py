from fastapi import APIRouter

router = APIRouter()


@router.post("")
def post():
    return {"todo": "implemented in next task"}
