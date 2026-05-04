import numpy as np


def transform_se2(R, t, point, forward=True):
    if R is None:
        return point

    point_xy = np.array([point[0], point[1]])
    if forward:
        new_point_xy = R @ point_xy + t
        new_point_theta = point[2] + np.arctan2(R[1, 0], R[0, 0])
        return np.concatenate((new_point_xy, [new_point_theta]))
    new_point_xy = R.T @ (point_xy - t)
    new_point_theta = point[2] - np.arctan2(R[1, 0], R[0, 0])
    return np.concatenate((new_point_xy, [new_point_theta]))
