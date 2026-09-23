from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Request, RequestStatus, User, to_naive_utc
from schemas import RequestCreate, RequestOut, ITEM_SIZE_UNITS
from auth import get_current_user

router = APIRouter()


@router.post("", response_model=RequestOut, status_code=status.HTTP_201_CREATED)
def create_request(payload: RequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = Request(
        user_id=current_user.id,
        pickup_location=payload.pickup_location,
        delivery_location=payload.delivery_location,
        earliest_time=to_naive_utc(payload.earliest_time),
        latest_time=to_naive_utc(payload.latest_time),
        item_size=ITEM_SIZE_UNITS[payload.item_size],
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


@router.get("", response_model=list[RequestOut])
def list_my_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Request).filter(Request.user_id == current_user.id).order_by(Request.created_at.desc()).all()


@router.get("/{request_id}", response_model=RequestOut)
def get_request(request_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(Request).filter(Request.id == request_id).first()
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this request")
    return req


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_request(request_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(Request).filter(Request.id == request_id).first()
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this request")
    if req.status != RequestStatus.OPEN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an open request can be deleted")
    db.delete(req)
    db.commit()
