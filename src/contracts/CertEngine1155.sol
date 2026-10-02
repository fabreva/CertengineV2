// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CertEngine1155 is ERC1155, Ownable {
    uint256 public maxSerializeBatch;
    mapping(bytes32 => bool) private _familyCreated;
    mapping(uint256 => bool) private _serialized;

    error OwnershipRenounceDisabled();
    error ZeroBatch();
    error ZeroFamily();
    error ZeroReceiver();
    error ZeroQuantity();
    error FamilyAlreadyCreated();
    error FamilyNotCreated();
    error EmptyProgressives();
    error BatchTooLarge();
    error ZeroProgressive();
    error DuplicateProgressive();
    error SerializedIdCollidesWithFamily();
    error SerializedTokenExists();
    error InsufficientFungibleBalance();

    event FamilyMinted(
        address indexed owner,
        bytes32 indexed familyId,
        uint256 indexed tokenId,
        uint256 quantity
    );

    event FamilySerialized(
        address indexed owner,
        bytes32 indexed familyId,
        uint256[] progressives,
        uint256[] tokenIds
    );

    constructor(address initialOwner, uint256 maxSerializeBatch_)
        ERC1155("")
        Ownable(initialOwner)
    {
        if (maxSerializeBatch_ == 0) revert ZeroBatch();
        maxSerializeBatch = maxSerializeBatch_;
    }

    function renounceOwnership() public pure override {
        revert OwnershipRenounceDisabled();
    }

    function mintFamily(bytes32 familyId, uint256 quantity, address receiver) external onlyOwner {
        if (familyId == bytes32(0)) revert ZeroFamily();
        if (receiver == address(0)) revert ZeroReceiver();
        if (quantity == 0) revert ZeroQuantity();
        if (_familyCreated[familyId]) revert FamilyAlreadyCreated();

        uint256 tokenId = uint256(familyId);
        _familyCreated[familyId] = true;
        _mint(receiver, tokenId, quantity, "");

        emit FamilyMinted(receiver, familyId, tokenId, quantity);
    }

    function serialize(bytes32 familyId, uint256[] calldata progressives, address receiver) external onlyOwner {
        if (familyId == bytes32(0)) revert ZeroFamily();
        if (receiver == address(0)) revert ZeroReceiver();
        if (!_familyCreated[familyId]) revert FamilyNotCreated();

        uint256 count = progressives.length;
        if (count == 0) revert EmptyProgressives();
        if (count > maxSerializeBatch) revert BatchTooLarge();

        uint256 familyToken = uint256(familyId);
        if (balanceOf(receiver, familyToken) < count) revert InsufficientFungibleBalance();

        uint256[] memory tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 progressive = progressives[i];
            if (progressive == 0) revert ZeroProgressive();
            for (uint256 j = 0; j < i; j++) {
                if (progressives[j] == progressive) revert DuplicateProgressive();
            }

            uint256 tokenId = serializedTokenId(familyId, progressive);
            if (tokenId == familyToken) revert SerializedIdCollidesWithFamily();
            if (_serialized[tokenId]) revert SerializedTokenExists();
            tokenIds[i] = tokenId;
        }

        _burn(receiver, familyToken, count);
        for (uint256 i = 0; i < count; i++) {
            _serialized[tokenIds[i]] = true;
            _mint(receiver, tokenIds[i], 1, "");
        }

        emit FamilySerialized(receiver, familyId, progressives, tokenIds);
    }

    function serializedTokenId(bytes32 familyId, uint256 progressive) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(familyId, progressive)));
    }
}
